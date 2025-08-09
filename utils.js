// utils.js
const { ethers } = require("ethers");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const isDebug = () => process.env.DEBUG && ["1", "true", "yes"].includes(String(process.env.DEBUG).toLowerCase());

const log = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};
const debug = (msg) => {
  if (isDebug()) console.debug("🔍", msg);
};

function classifyError(err) {
  const m = ((err && err.message) || String(err)).toLowerCase();
  return {
    message: m,
    insufficientFunds: m.includes("insufficient funds"),
    underpriced:
      m.includes("underpriced") || m.includes("max fee per gas less than block base fee") || m.includes("fee too low"),
    nonceTooLow: m.includes("nonce too low") || m.includes("already been used"),
    replacementUnderpriced: m.includes("replacement transaction underpriced"),
    unpredictableGas: m.includes("unpredictable gas") || m.includes("cannot estimate gas"),
    userDenied: m.includes("user denied"),
  };
}

async function getStartingFees(provider, cfg) {
  if (cfg.MAX_FEE_GWEI && cfg.MAX_PRIORITY_GWEI) {
    return {
      type: "eip1559",
      maxFeePerGas: ethers.utils.parseUnits(String(cfg.MAX_FEE_GWEI), "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits(String(cfg.MAX_PRIORITY_GWEI), "gwei"),
    };
  }
  if (cfg.GAS_PRICE_GWEI) {
    return {
      type: "legacy",
      gasPrice: ethers.utils.parseUnits(String(cfg.GAS_PRICE_GWEI), "gwei"),
    };
  }
  const fee = await provider.getFeeData();
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    return { type: "eip1559", maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas };
  }
  return { type: "legacy", gasPrice: fee.gasPrice || ethers.utils.parseUnits("20", "gwei") };
}

function bumpLegacyGas(gp, percent) {
  return gp.mul(100 + percent).div(100).add(1); // +1 wei safety
}

function bumpEip1559(fees, percent) {
  const next = { ...fees };
  next.maxFeePerGas = next.maxFeePerGas.mul(100 + percent).div(100).add(1);
  next.maxPriorityFeePerGas = next.maxPriorityFeePerGas.mul(100 + percent).div(100).add(1);
  return next;
}

module.exports = {
  sleep,
  log,
  debug,
  classifyError,
  getStartingFees,
  bumpLegacyGas,
  bumpEip1559,
};
