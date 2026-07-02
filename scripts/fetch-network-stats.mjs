#!/usr/bin/env node
/**
 * fetch-network-stats.mjs
 *
 * Build-time script that queries live *observed network state* (Bucket B) from
 * the Pocket Network Sauron LCD endpoint and writes it to a JSON file.
 *
 * This is the twin of fetch-governance-params.mjs. That script handles
 * governance parameters (change only by DAO vote); this one handles values
 * that drift continuously — total supply, etc. — so they never get hardcoded
 * into token documentation and go stale.
 *
 * Run: node scripts/fetch-network-stats.mjs
 * Output: data/network-stats.json
 *
 * Consumed by the <NetworkStat> MDX component.
 *
 * Design note — graceful degradation:
 *   Unlike governance params, a missing network stat must NOT fail the build.
 *   Any metric we can't fetch is written as { value: null }, and <NetworkStat>
 *   renders its `fallback` (typically a "see live source" link) instead.
 *   Only cleanly single-endpoint metrics are fetched here. Analytics-heavy
 *   figures (daily burn/mint, staked %) are intentionally NOT transcribed —
 *   the docs link out to pokt.money / POKTscan for those.
 *
 * Environment variables:
 *   SAURON_LCD_URL  — Override the default Sauron REST endpoint
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

const UPOKT_PER_POKT = 1_000_000;

async function fetchJson(path) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const json = await res.json();
  if (json.code) throw new Error(`RPC error ${json.code} — ${json.message}`);
  return json;
}

/**
 * Each metric is a self-contained fetcher returning { value, unit, source_url }.
 * value is null-able; a throw is caught and recorded as null.
 */
const METRICS = {
  async total_supply() {
    const path = "/cosmos/bank/v1beta1/supply/by_denom?denom=upokt";
    const json = await fetchJson(path);
    const upokt = Number(json?.amount?.amount);
    if (!Number.isFinite(upokt)) throw new Error("no amount in response");
    return {
      value: upokt / UPOKT_PER_POKT,
      unit: "pokt",
      source_url: `${BASE_URL}${path}`,
    };
  },
};

async function main() {
  const fetched_at = new Date().toISOString();
  console.log(`Fetching network stats from ${BASE_URL} (${NETWORK})...\n`);

  const result = {
    _meta: { fetched_at, source: BASE_URL, network: NETWORK },
    metrics: {},
  };

  for (const [name, fetcher] of Object.entries(METRICS)) {
    try {
      const data = await fetcher();
      result.metrics[name] = { ...data, as_of: fetched_at };
      console.log(`  ✓ ${name} = ${data.value} ${data.unit}`);
    } catch (err) {
      result.metrics[name] = { value: null, error: err.message, as_of: fetched_at };
      console.warn(`  ✗ ${name}: ${err.message} (rendering fallback)`);
    }
  }

  const outDir = join(__dirname, "..", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "network-stats.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nWrote ${outPath}`);
  // Never exit non-zero: a soft stat must not break the build.
}

main();
