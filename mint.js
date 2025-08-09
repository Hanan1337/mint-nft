// mint.js
const { ethers } = require("ethers");
const { sleep, log, debug, classifyError, getStartingFees, bumpLegacyGas, bumpEip1559 } = require("./utils");

function buildAbi(cfg) {
  if (cfg.ABI_OVERRIDE) return cfg.ABI_OVERRIDE;
  return [`function ${cfg.MINT_FUNC}(uint256 _count) payable`];
}

function getMintArgs(cfg) {
  if (Array.isArray(cfg.MINT_ARGS)) return cfg.MINT_ARGS;
  // Default: hanya jumlah
  return [cfg.MINT_AMOUNT_BN];
}

function baseOverrides(cfg) {
  const args = getMintArgs(cfg);
  // Nilai total = price per mint * MINT_AMOUNT (default). Jika pakai MINT_ARGS kustom, asumsi tetap pakai MINT_AMOUNT_BN.
  const value = cfg.PRICE_WEI.mul(cfg.MINT_AMOUNT_BN);
  const o = { value };
  if (cfg.GAS_LIMIT) o.gasLimit = cfg.GAS_LIMIT;
  return o;
}

async function prepareOverrides(contract, cfg, feeFields) {
  const overrides = { ...baseOverrides(cfg), ...feeFields };

  // Gas estimation (with 20% buffer) jika belum diberi GAS_LIMIT
  if (!overrides.gasLimit) {
    try {
      const args = getMintArgs(cfg);
      const est = await contract.estimateGas[cfg.MINT_FUNC](...args, overrides);
      overrides.gasLimit = est.mul(120).div(100);
      debug(`Estimated gas: ${est.toString()} -> with buffer: ${overrides.gasLimit.toString()}`);
    } catch (e) {
      const m = (e && e.message) || String(e);
      log.warn(`estimateGas gagal: ${m}. Pertimbangkan set GAS_LIMIT secara manual.`);
      // lanjut tanpa gasLimit eksplisit; ethers akan coba estimate saat send
      delete overrides.gasLimit;
    }
  }

  // Optional simulate
  if (cfg.DRY_RUN) {
    const args = getMintArgs(cfg);
    await contract.callStatic[cfg.MINT_FUNC](...args, overrides);
    log.info("✅ Simulasi callStatic sukses. (DRY_RUN=1)");
  }
  return overrides;
}

async function buildTxRequest(contract, cfg, feeMode) {
  const feeFields =
    feeMode.type === "legacy"
      ? { gasPrice: feeMode.gasPrice }
      : { maxFeePerGas: feeMode.maxFeePerGas, maxPriorityFeePerGas: feeMode.maxPriorityFeePerGas };

  const overrides = await prepareOverrides(contract, cfg, feeFields);
  const args = getMintArgs(cfg);
  const txData = await contract.populateTransaction[cfg.MINT_FUNC](...args, overrides);

  // Pastikan value & gasLimit terpampang di tx request
  return {
    ...txData,
    ...feeFields,
    value: overrides.value,
    gasLimit: overrides.gasLimit, // bisa undefined, itu oke
  };
}

async function sendWithRetry(wallet, contract, provider, cfg) {
  let attempt = 0;
  let waitMs = cfg.RETRY_BACKOFF_MS;
  let fees = await getStartingFees(provider, cfg);

  // Nonce "pending" agar langsung menggantikan tx pending saat bump
  const baseNonce = await provider.getTransactionCount(wallet.address, "pending");
  const nonce = baseNonce;
  debug(`Using nonce=${nonce} for wallet=${wallet.address}`);

  while (true) {
    try {
      // Bangun tx request segar setiap attempt (agar gasLimit/fees bisa berubah)
      const txReq = await buildTxRequest(contract, cfg, fees);
      txReq.nonce = nonce;

      if (!cfg.DRY_RUN) {
        const tx = await wallet.sendTransaction(txReq);
        log.info(`🚀 Tx sent: ${tx.hash} (attempt ${attempt + 1}, nonce ${nonce})`);
        const rc = await tx.wait();
        if (rc.status !== 1) throw new Error(`Receipt status 0 (reverted). Tx: ${rc.transactionHash}`);
        log.info(`✅ Success: ${rc.transactionHash} | Block: ${rc.blockNumber}`);
        return rc;
      } else {
        // DRY_RUN mode: kita sudah callStatic di prepareOverrides; cukup log detail
        log.info("DRY_RUN=1: transaksi tidak dibroadcast.");
        return { dryRun: true, nonce, fees };
      }
    } catch (err) {
      attempt++;
      const c = classifyError(err);
      log.warn(`❌ Attempt ${attempt} failed: ${c.message}`);

      if (c.insufficientFunds) {
        throw new Error("Insufficient funds: saldo tidak cukup untuk gas atau value.");
      }
      if (attempt >= cfg.RETRY_ATTEMPTS) {
        throw err;
      }

      // Bump gas untuk replacement
      if (fees.type === "legacy") {
        fees = { type: "legacy", gasPrice: bumpLegacyGas(fees.gasPrice, cfg.GAS_BUMP_PERCENT) };
      } else {
        fees = { type: "eip1559", ...bumpEip1559(fees, cfg.GAS_BUMP_PERCENT) };
      }

      const jitter = Math.floor(Math.random() * 400); // jitter kecil
      const delay = Math.max(250, Math.ceil(waitMs)) + jitter;

      if (c.replacementUnderpriced || c.underpriced) {
        log.info(`⏳ Underpriced. Retrying sooner with higher gas in ${delay}ms...`);
      } else {
        log.info(`⏳ Retrying in ${delay}ms with higher gas...`);
      }

      await sleep(delay);
      waitMs = waitMs * cfg.RETRY_BACKOFF_MULTIPLIER;
    }
  }
}

function buildContract(provider, cfg, privateKey) {
  const wallet = new ethers.Wallet(privateKey, provider);
  const abi = buildAbi(cfg);
  const contract = new ethers.Contract(cfg.CHECKSUM_ADDRESS || cfg.CONTRACT_ADDRESS, abi, wallet);
  return { wallet, contract };
}

async function runSingle(provider, cfg) {
  const { wallet, contract } = buildContract(provider, cfg, cfg.PRIVATE_KEY);
  const bal = await provider.getBalance(wallet.address);
  debug(`Wallet: ${wallet.address} | Balance: ${ethers.utils.formatEther(bal)} ETH`);
  return sendWithRetry(wallet, contract, provider, cfg);
}

async function runMulti(provider, cfg) {
  const keys = cfg.PRIVATE_KEYS;
  const parallel = Math.max(1, cfg.PARALLEL || 1);
  const delayMs = Math.max(0, cfg.TX_DELAY_MS || 0);

  // Jalankan per batch paralel sederhana
  for (let i = 0; i < keys.length; i += parallel) {
    const batch = keys.slice(i, i + parallel);
    await Promise.all(
      batch.map(async (pk, idx) => {
        try {
          if (idx > 0 && delayMs > 0) await sleep(idx * delayMs);
          const { wallet, contract } = buildContract(provider, cfg, pk);
          const bal = await provider.getBalance(wallet.address);
          debug(`Wallet: ${wallet.address} | Balance: ${ethers.utils.formatEther(bal)} ETH`);
          await sendWithRetry(wallet, contract, provider, cfg);
        } catch (e) {
          log.error(`Wallet batch error: ${(e && e.message) || String(e)}`);
        }
      })
    );
    if (i + parallel < keys.length && delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

module.exports = { runSingle, runMulti };
