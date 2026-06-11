#!/usr/bin/env node
/**
 * fetch-ansible-docs.mjs
 *
 * Build-time script that pulls the Ansible automation guides from
 * tsulhc/pocket-automations and writes them into the docs content collection
 * as the "Ansible Automations" section.
 *
 *   README.md      -> ansible-automations/index.md   (section landing page)
 *   docs/<name>.md -> ansible-automations/<name>.md  (child guides)
 *
 * The source files are plain Markdown with a single leading H1 and no
 * frontmatter, so this script:
 *   - strips the leading H1 (DocsLayout renders the title itself),
 *   - synthesises frontmatter (title from the H1, short description),
 *   - rewrites local .md links to the on-site routes,
 *   - prepends a provenance note linking back to the source.
 *
 * They are written as .md (NOT .mdx) on purpose: Ansible docs contain
 * `{{ jinja }}` and angle brackets that the MDX compiler would choke on.
 * The content.config.ts glob includes .md for exactly this reason.
 *
 * Always pulls the latest from the source repo's default branch on every
 * build. The output directory is git-ignored (generated artifact).
 *
 * Run: node scripts/fetch-ansible-docs.mjs
 * Source: https://github.com/tsulhc/pocket-automations
 *
 * NOTE: pocket-automations currently has no LICENSE. Redistributing its
 * content requires permission from the maintainer — confirm before publishing.
 */

import { writeFileSync, mkdirSync, rmSync } from "fs";
import { dirname, join, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OWNER = "tsulhc";
const REPO = "pocket-automations";
const BRANCH = "master";
const SECTION_KEY = "ansible-automations";
const SECTION_LABEL = "Ansible Automations";

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const SRC_BLOB = `https://github.com/${OWNER}/${REPO}/blob/${BRANCH}`;

const OUT_DIR = join(__dirname, "..", "src", "content", "docs", SECTION_KEY);
const ROUTE = `/${SECTION_KEY}`;

const ghHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "pocket-docs-build",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: ghHeaders,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "pocket-docs-build" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

// Fallback title from a filename: "secret-rotation.md" -> "Secret Rotation".
function titleFromName(name) {
  return name
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Pull the first H1 as the title and strip it (plus a trailing blank) from the body.
function extractTitle(md, fallback) {
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const m = lines[i].match(/^#\s+(.+?)\s*$/);
    if (m) {
      lines.splice(i, 1);
      if (lines[i] === "") lines.splice(i, 1);
      return { title: m[1].trim(), body: lines.join("\n") };
    }
    break; // first real line wasn't an H1 — leave body untouched
  }
  return { title: fallback, body: md };
}

// First prose line -> short description (best-effort, optional).
function extractDescription(body) {
  for (const raw of body.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^(#|>|```|-|\*|\||\d+\.)/.test(t)) continue;
    const clean = t.replace(/[`*_[\]]/g, "").replace(/\(https?:\/\/[^)]+\)/g, "").trim();
    if (clean.length <= 180) return clean;
    return clean.slice(0, 180).replace(/\s+\S*$/, "") + "…"; // cut at a word boundary
  }
  return "";
}

// Rewrite local Markdown links to .md files into on-site routes.
//   docs/foo.md            -> /ansible-automations/foo/
//   ./foo.md#section        -> /ansible-automations/foo/#section
//   ../README.md            -> /ansible-automations/
function rewriteLinks(body) {
  return body.replace(/\]\(([^)\s]+?\.md)(#[^)\s]*)?\)/g, (full, path, anchor = "") => {
    if (/^https?:\/\//i.test(path)) return full; // leave absolute URLs alone
    const slug = basename(path).replace(/\.md$/i, "");
    const route = /^readme$/i.test(slug) ? `${ROUTE}/` : `${ROUTE}/${slug}/`;
    return `](${route}${anchor})`;
  });
}

function frontmatter({ title, description }) {
  const fm = [`title: ${JSON.stringify(title)}`];
  if (description) fm.push(`description: ${JSON.stringify(description)}`);
  fm.push(`section: ${JSON.stringify(SECTION_KEY)}`);
  return `---\n${fm.join("\n")}\n---\n`;
}

function buildPage({ forcedTitle, fallbackTitle, srcPath, rawBody }) {
  const { title: h1, body } = extractTitle(rawBody, fallbackTitle ?? "Untitled");
  const title = forcedTitle ?? h1;
  const linked = rewriteLinks(body);
  const description = extractDescription(linked);
  const note =
    `> This guide is auto-synced from ` +
    `[\`${srcPath}\`](${SRC_BLOB}/${srcPath}) in the **pocket-automations** ` +
    `repo. Edit it there — changes here are overwritten on every build.\n`;
  return frontmatter({ title, description }) + "\n" + note + "\n" + linked.trim() + "\n";
}

async function main() {
  console.log(`Fetching Ansible automation docs from ${OWNER}/${REPO}@${BRANCH}...`);

  // 1. Enumerate markdown files under docs/ (the only GitHub API call).
  let docFiles;
  try {
    const listing = await fetchJSON(`${API}/contents/docs?ref=${BRANCH}`);
    docFiles = listing
      .filter((f) => f.type === "file" && /\.md$/i.test(f.name))
      .map((f) => ({ name: f.name, path: f.path }));
  } catch (err) {
    console.error(`  ✗ Failed to list docs/: ${err.message}`);
    console.error(
      "  ✗ Aborting — the Ansible Automations section will be empty this build."
    );
    process.exitCode = 1;
    return;
  }

  // Reset output dir so files removed upstream don't linger locally.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;

  // 2. README.md -> section landing page.
  try {
    const readme = await fetchText(`${RAW}/README.md`);
    writeFileSync(
      join(OUT_DIR, "index.md"),
      buildPage({ forcedTitle: SECTION_LABEL, srcPath: "README.md", rawBody: readme })
    );
    written++;
  } catch (err) {
    console.warn(`  ⚠ Skipped README.md: ${err.message}`);
  }

  // 3. docs/*.md -> child guides.
  for (const f of docFiles) {
    try {
      const raw = await fetchText(`${RAW}/${f.path}`);
      writeFileSync(
        join(OUT_DIR, f.name),
        buildPage({ fallbackTitle: titleFromName(f.name), srcPath: f.path, rawBody: raw })
      );
      written++;
    } catch (err) {
      console.warn(`  ⚠ Skipped ${f.path}: ${err.message}`);
    }
  }

  console.log(`  ✓ Wrote ${written} page(s) to ${OUT_DIR}`);
}

main();
