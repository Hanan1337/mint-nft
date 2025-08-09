// config.js
require("dotenv").config();
const { ethers } = require("ethers");

function toBN(x) {
  return ethers.BigNumber.from(String(x));
}

function parseBoolean(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(s);
}

function parseArrayCSV(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadConfig() {
  const MODE = (process.env.MODE || "single").toLowerCase();

  // Fees
  const MINT_PRICE = String(process.env.MINT_PRICE || "0");
  const PRICE_WEI = ethers.utils.parseEther(MINT_PRICE);
  const GAS_LIMIT = process.env.GAS_LIMIT ? toBN(process.env.GAS_LIMIT) : undefined;

  // Retry / bump
  const RETRY_ATTEMPTS = Number(process.env.RETRY_ATTEMPTS || 5);
  const RETRY_BACKOFF_MS = Number(process.env.RETRY_BACKOFF_MS || 2000);
  const RETRY_BACKOFF_MULTIPLIER = Number(process.env.RETRY_BACKOFF_MULTIPLIER || 1.6);
  const GAS_BUMP_PERCENT = Number(process.env.GAS_BUMP_PERCENT || 15);

  // EIP-1559 override
  const MAX_FEE_GWEI = process.env.MAX_FEE_GWEI;
  const MAX_PRIORITY_GWEI = process.env.MAX_PRIORITY_GWEI;

  // Args
  const mintAmountBN = toBN(process.env.MINT_AMOUNT || 1);
  let MINT_ARGS = null;
  if (process.env.MINT_ARGS && process.env.MINT_ARGS.trim()) {
    try {
      const arr = JSON.parse(process.env.MINT_ARGS);
      if (!Array.isArray(arr)) throw new Error("MINT_ARGS must be JSON array");
      MINT_ARGS = arr;
    } catch (e) {
      throw new Error(`MINT_ARGS invalid JSON: ${e.message}`);
    }
  }

  // ABI
  let ABI_OVERRIDE = undefined;
  if (process.env.ABI_OVERRIDE && process.env.ABI_OVERRIDE.trim()) {
    try {
      ABI_OVERRIDE = JSON.parse(process.env.ABI_OVERRIDE.trim());
      if (!Array.isArray(ABI_OVERRIDE)) {
        throw new Error("ABI_OVERRIDE must be JSON array (ABI fragment)");
      }
    } catch (e) {
      throw new Error(`ABI_OVERRIDE invalid JSON: ${e.message}`);
    }
  }

  return {
    // Network
    RPC_URL: process.env.RPC_URL,
    CHAIN_ID: process.env.CHAIN_ID,

    // Contract
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
    MINT_FUNC: (process.env.MINT_FUNC || "mint").trim(),

    // Price/amount
    MINT_PRICE,
    PRICE_WEI,
    MINT_AMOUNT_BN: mintAmountBN,
    GAS_LIMIT,

    // Mode & keys
    MODE,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    PRIVATE_KEYS: parseArrayCSV(process.env.PRIVATE_KEYS || ""),
    TX_DELAY_MS: Number(process.env.TX_DELAY_MS || 2000),
    PARALLEL: Math.max(1, Number(process.env.PARALLEL || 1)),

    // Retry / backoff / bump
    RETRY_ATTEMPTS,
    RETRY_BACKOFF_MS,
    RETRY_BACKOFF_MULTIPLIER,
    GAS_BUMP_PERCENT,

    // Fee overrides
    MAX_FEE_GWEI,
    MAX_PRIORITY_GWEI,
    GAS_PRICE_GWEI: process.env.GAS_PRICE_GWEI,

    // Advanced
    DRY_RUN: parseBoolean(process.env.DRY_RUN || "0"),
    DEBUG: parseBoolean(process.env.DEBUG || "0"),

    // ABI & args
    ABI_OVERRIDE,
    MINT_ARGS,
  };
}

function validateConfig(cfg) {
  if (!cfg.RPC_URL) throw new Error("RPC_URL kosong");
  if (!cfg.CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS kosong");
  try {
    cfg.CHECKSUM_ADDRESS = ethers.utils.getAddress(cfg.CONTRACT_ADDRESS);
  } catch {
    throw new Error("CONTRACT_ADDRESS tidak valid (checksum gagal)");
  }
  if (cfg.MODE === "multi") {
    if (!cfg.PRIVATE_KEYS.length) throw new Error("MODE=multi membutuhkan PRIVATE_KEYS (dipisah koma)");
  } else {
    if (!cfg.PRIVATE_KEY) throw new Error("PRIVATE_KEY kosong untuk MODE single/simple");
  }
  if (cfg.MINT_AMOUNT_BN.lte(0)) throw new Error("MINT_AMOUNT harus > 0");
}

module.exports = { loadConfig, validateConfig, toBN };
