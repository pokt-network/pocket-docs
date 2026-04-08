#!/usr/bin/env node
/**
 * fetch-governance-params.mjs
 *
 * Build-time script that queries all governance module parameters from
 * the Pocket Network Sauron LCD endpoint and writes them to a JSON file.
 *
 * Run: node scripts/fetch-governance-params.mjs
 * Output: data/governance-params.json
 *
 * This script runs automatically on every docs build. The output JSON is
 * consumed by the <GovParam> and <GovParamBlock> MDX components so that
 * governance values are never hardcoded in documentation content.
 *
 * Environment variables:
 *   SAURON_LCD_URL  — Override the default Sauron REST endpoint
 *                     (default: https://sauron-api.infra.pocket.network)
 *   NETWORK         — "mainnet" (default) or "testnet"
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAINNET_LCD = "https://sauron-api.infra.pocket.network";
const TESTNET_LCD = "https://sauron-api.beta.infra.pocket.network";

const NETWORK = process.env.NETWORK || "mainnet";
const BASE_URL =
  process.env.SAURON_LCD_URL ||
  (NETWORK === "testnet" ? TESTNET_LCD : MAINNET_LCD);

const MODULES = [
  "application",
  "supplier",
  "gateway",
  "tokenomics",
  "shared",
  "proof",
  "service",
  "session",
  "migration",
];

async function fetchModuleParams(module) {
  const url = `${BASE_URL}/pokt-network/poktroll/${module}/params`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`${module}: HTTP ${res.status} from ${url}`);
  }

  const json = await res.json();

  if (json.code) {
    throw new Error(
      `${module}: RPC error code ${json.code} — ${json.message}`
    );
  }

  return json.params;
}

/**
 * Flatten nested param objects into dot-notation keys for easy lookup.
 *
 * Examples:
 *   { min_stake: { amount: "1000000000", denom: "upokt" } }
 *     → min_stake           = { amount, denom }
 *     → min_stake.amount    = "1000000000"
 *     → min_stake.denom     = "upokt"
 *
 *   { mint_allocation_percentages: { dao: 0.1, supplier: 0.8, ... } }
 *     → mint_allocation_percentages       = { dao, supplier, ... }
 *     → mint_allocation_percentages.dao   = 0.1
 *     → mint_allocation_percentages.supplier = 0.8
 */
function flattenParams(params) {
  const flat = {};

  for (const [key, value] of Object.entries(params)) {
    flat[key] = value;

    if (value && typeof value === "object") {
      for (const [subKey, subValue] of Object.entries(value)) {
        flat[`${key}.${subKey}`] = subValue;
      }
    }
  }

  return flat;
}

async function main() {
  console.log(
    `Fetching governance params from ${BASE_URL} (${NETWORK})...\n`
  );

  const result = {
    _meta: {
      fetched_at: new Date().toISOString(),
      source: BASE_URL,
      network: NETWORK,
    },
    modules: {},
  };

  let failures = 0;

  for (const mod of MODULES) {
    try {
      const params = await fetchModuleParams(mod);
      result.modules[mod] = {
        raw: params,
        flat: flattenParams(params),
      };
      console.log(`  ✓ ${mod}`);
    } catch (err) {
      console.error(`  ✗ ${mod}: ${err.message}`);
      failures++;
    }
  }

  const outDir = join(__dirname, "..", "data");
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, "governance-params.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (failures > 0) {
    console.error(
      `\n⚠ ${failures} module(s) failed. Check Sauron availability.`
    );
    process.exit(1);
  }
}

main();
