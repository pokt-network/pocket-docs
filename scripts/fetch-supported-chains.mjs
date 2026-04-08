#!/usr/bin/env node
/**
 * fetch-supported-chains.mjs
 *
 * Build-time script that fetches the supported chains list from the
 * pokt-network/public-rpc GitHub repository and writes it to a JSON file.
 *
 * Run: node scripts/fetch-supported-chains.mjs
 * Output: data/supported-chains.json
 *
 * This script runs automatically on every docs build. The output JSON is
 * consumed by the <SupportedChains /> Astro component on the
 * /developers/supported-chains page.
 *
 * Source: https://raw.githubusercontent.com/pokt-network/public-rpc/refs/heads/main/supported-chains.json
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHAINS_URL =
  "https://raw.githubusercontent.com/pokt-network/public-rpc/refs/heads/main/supported-chains.json";

async function main() {
  console.log(`Fetching supported chains from GitHub...\n  ${CHAINS_URL}\n`);

  let data;
  try {
    const res = await fetch(CHAINS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    // The JSON may be wrapped: { chains: [...], version: ..., ... }
    // or may be a bare array — handle both
    data = Array.isArray(json) ? json : (json.chains ?? json);
  } catch (err) {
    console.error(`  ✗ Failed to fetch supported chains: ${err.message}`);
    console.warn(
      "  ⚠ Using empty fallback. SupportedChains component will show a notice."
    );
    data = [];
  }

  const outDir = join(__dirname, "..", "data");
  mkdirSync(outDir, { recursive: true });

  const result = {
    _meta: {
      fetched_at: new Date().toISOString(),
      source: CHAINS_URL,
    },
    chains: data,
  };

  const outPath = join(outDir, "supported-chains.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  const count = Array.isArray(data) ? data.length : "unknown";
  console.log(`  ✓ Wrote ${count} chains to ${outPath}`);
}

main();
