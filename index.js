// index.js
const { ethers } = require("ethers");
const { loadConfig, validateConfig } = require("./config");
const { log, debug } = require("./utils");
const { runSingle, runMulti } = require("./mint");

async function preflight(provider, cfg) {
  const net = await provider.getNetwork();
  log.info(`Network: chainId=${net.chainId}`);
  debug(`RPC: ${cfg.RPC_URL}`);

  if (cfg.CHAIN_ID && Number(cfg.CHAIN_ID) !== Number(net.chainId)) {
    throw new Error(`CHAIN_ID mismatch: expected ${cfg.CHAIN_ID}, got ${net.chainId}`);
  }
}

async function main() {
  const cfg = loadConfig();
  validateConfig(cfg);

  const provider = new ethers.providers.JsonRpcProvider(cfg.RPC_URL);
  await preflight(provider, cfg);

  if (cfg.MODE === "multi") {
    await runMulti(provider, cfg);
  } else {
    await runSingle(provider, cfg);
  }
}

main().catch((e) => {
  log.error(`Fatal: ${e && e.message ? e.message : String(e)}`);
  process.exit(1);
});
