#!/usr/bin/env node
/**
 * fetch-igniter-docs.mjs
 *
 * Build-time script that pulls the Igniter staking-app docs from
 * pokt-network/igniter and writes them into the docs content collection as
 * the "Igniter" section (placed under "Node Operators" in the sidebar).
 *
 *   README.md                -> igniter/index.md     (section overview)
 *   apps/provider/README.md  -> igniter/provider.md  (Provider sub-page)
 *   apps/middleman/README.md -> igniter/middleman.md (Middleman sub-page)
 *
 * Unlike the Ansible sync, Igniter pulls a fixed set of files (not a whole
 * directory) because the section has a deliberate overview + two sub-pages
 * shape. The source READMEs are plain Markdown with a single leading H1 and
 * no frontmatter, so this script:
 *   - strips the leading H1 (DocsLayout renders the title itself),
 *   - synthesises frontmatter (forced title, short description, section),
 *   - rewrites the two cross-app links (provider/middleman README) to the
 *     on-site routes for those sub-pages,
 *   - rewrites every other repo-relative link/image to an absolute GitHub URL
 *     (those files — CONTRIBUTING.md, docs/guides/*, docker-compose/*, the
 *     logo assets — are NOT hosted here, so a relative path would 404),
 *   - prepends a provenance note linking back to the source.
 *
 * They are written as .md (NOT .mdx) on purpose: the READMEs contain raw HTML
 * (a <picture> logo block, HTML comments) and `${...}` shell interpolation in
 * tables that the MDX compiler would choke on. The content.config.ts glob
 * includes .md for exactly this reason.
 *
 * Always pulls the latest from the source repo's default branch on every
 * build. The output directory is git-ignored (generated artifact).
 *
 * Run: node scripts/fetch-igniter-docs.mjs
 * Source: https://github.com/pokt-network/igniter
 *
 * NOTE: pokt-network/igniter currently has no LICENSE file. It is the official
 * Pocket Network org repo (funded by PNF), but redistribution isn't formally
 * licensed yet — confirm before publishing externally.
 */

import { writeFileSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { posix } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OWNER = "pokt-network";
const REPO = "igniter";
const BRANCH = "main";
const SECTION_KEY = "igniter";
const SECTION_LABEL = "Igniter";

const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const BLOB = `https://github.com/${OWNER}/${REPO}/blob/${BRANCH}`;
const TREE = `https://github.com/${OWNER}/${REPO}/tree/${BRANCH}`;

const OUT_DIR = join(__dirname, "..", "src", "content", "docs", SECTION_KEY);
const ROUTE = `/${SECTION_KEY}`;

// The fixed set of pages this section is built from. Order is presentational
// only — the sidebar sorts the index page first, then alphabetically by title.
const PAGES = [
  { slug: "index", srcPath: "README.md", title: SECTION_LABEL },
  { slug: "provider", srcPath: "apps/provider/README.md", title: "Provider" },
  { slug: "middleman", srcPath: "apps/middleman/README.md", title: "Middleman" },
];

// Map of repo-relative path -> on-site route, so cross-references between the
// three pages resolve internally instead of bouncing out to GitHub.
const INTERNAL = new Map(
  PAGES.map((p) => [p.srcPath, p.slug === "index" ? `${ROUTE}/` : `${ROUTE}/${p.slug}/`])
);

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "pocket-docs-build" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
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
    if (/^(#|>|```|-|\*|\||\d+\.|!\[|<)/.test(t)) continue;
    const clean = t.replace(/[`*_[\]]/g, "").replace(/\(https?:\/\/[^)]+\)/g, "").trim();
    if (!clean) continue;
    if (clean.length <= 180) return clean;
    return clean.slice(0, 180).replace(/\s+\S*$/, "") + "…"; // cut at a word boundary
  }
  return "";
}

// Resolve a single relative link/image target against the page's source
// directory. Returns the rewritten URL, or null to leave the target untouched
// (absolute URLs, anchors, mailto:, etc.).
//   - cross-app README links  -> on-site route (e.g. /igniter/provider/)
//   - image / src / srcset    -> absolute raw.githubusercontent.com URL
//   - any other repo file/dir -> absolute github.com blob/tree URL
function resolveTarget(target, baseDir, { asset }) {
  if (/^(https?:|mailto:|tel:|data:|#)/i.test(target)) return null;

  const hashIdx = target.indexOf("#");
  const pathPart = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
  const anchor = hashIdx >= 0 ? target.slice(hashIdx) : "";
  if (pathPart === "") return null; // pure anchor — same-page, leave it

  // Normalise to a repo-root-relative path (strips ./ and ../ segments).
  const repoPath = posix
    .normalize(posix.join(baseDir, pathPart))
    .replace(/^\.\//, "")
    .replace(/\/$/, "");

  const internal = INTERNAL.get(repoPath);
  if (internal) return internal + anchor;

  if (asset) return `${RAW}/${repoPath}`;

  // No file extension -> treat as a directory (GitHub tree view).
  const base = posix.extname(repoPath) ? BLOB : TREE;
  return `${base}/${repoPath}${anchor}`;
}

// Rewrite Markdown images, HTML src/srcset attributes, and Markdown links.
// Order matters: convert images and HTML assets to absolute URLs first, so the
// trailing link pass sees them as already-absolute and leaves them alone.
function rewriteLinks(body, baseDir) {
  let out = body;

  // Markdown images: ![alt](path)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (full, alt, target) => {
    const rewritten = resolveTarget(target, baseDir, { asset: true });
    return rewritten ? `![${alt}](${rewritten})` : full;
  });

  // HTML attributes: src="path" / srcset="path"
  out = out.replace(/\b(src|srcset)="([^"]+)"/g, (full, attr, target) => {
    const rewritten = resolveTarget(target, baseDir, { asset: true });
    return rewritten ? `${attr}="${rewritten}"` : full;
  });

  // Markdown links: [text](path) — images are already absolute, so they no-op.
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (full, text, target) => {
    const rewritten = resolveTarget(target, baseDir, { asset: false });
    return rewritten ? `[${text}](${rewritten})` : full;
  });

  return out;
}

function frontmatter({ title, description }) {
  const fm = [`title: ${JSON.stringify(title)}`];
  if (description) fm.push(`description: ${JSON.stringify(description)}`);
  fm.push(`section: ${JSON.stringify(SECTION_KEY)}`);
  return `---\n${fm.join("\n")}\n---\n`;
}

function buildPage({ title, srcPath, rawBody }) {
  const baseDir = posix.dirname(srcPath) === "." ? "" : posix.dirname(srcPath);
  const { body } = extractTitle(rawBody, title);
  const linked = rewriteLinks(body, baseDir);
  const description = extractDescription(linked);
  const note =
    `> This page is auto-synced from ` +
    `[\`${srcPath}\`](${BLOB}/${srcPath}) in the **pokt-network/igniter** ` +
    `repo. Edit it there — changes here are overwritten on every build.\n`;
  return frontmatter({ title, description }) + "\n" + note + "\n" + linked.trim() + "\n";
}

async function main() {
  console.log(`Fetching Igniter docs from ${OWNER}/${REPO}@${BRANCH}...`);

  // Build all pages in memory first; only touch the output dir if every fetch
  // succeeds, so a transient failure can't leave a half-written section.
  const built = [];
  for (const page of PAGES) {
    try {
      const rawBody = await fetchText(`${RAW}/${page.srcPath}`);
      built.push({
        file: page.slug === "index" ? "index.md" : `${page.slug}.md`,
        content: buildPage({ title: page.title, srcPath: page.srcPath, rawBody }),
      });
    } catch (err) {
      console.error(`  ✗ Failed to fetch ${page.srcPath}: ${err.message}`);
      console.error(
        "  ✗ Aborting — leaving any existing Igniter section in place this build."
      );
      process.exitCode = 1;
      return;
    }
  }

  // Reset output dir so files removed upstream don't linger locally.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const { file, content } of built) {
    writeFileSync(join(OUT_DIR, file), content);
  }

  console.log(`  ✓ Wrote ${built.length} page(s) to ${OUT_DIR}`);
}

main();
