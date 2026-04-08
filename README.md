# Pocket Network Documentation

Source for [docs.pocket.network](https://docs.pocket.network) — the official documentation site for Pocket Network.

Built with [Astro](https://astro.build), [Tailwind CSS](https://tailwindcss.com), and [MDX](https://mdxjs.com). Deployed automatically to GitHub Pages on every push to `main`.

---

## Running locally

**Requirements:** Node.js 22+

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:4321`. It fetches live governance parameters and supported chain data on startup.

To preview the production build locally:

```bash
npm run build
npx pagefind --site dist
npm run preview
```

---

## Project structure

```
src/
  content/docs/   # MDX documentation pages
  components/     # Astro components (Callout, Tabs, GovParam, etc.)
  layouts/        # Page layout (DocsLayout.astro)
  styles/         # Global CSS and design tokens
  pages/          # Astro routes ([...slug].astro, index.astro)
scripts/          # Build-time data fetchers (governance params, chains)
data/             # Generated at build time — do not edit manually
public/           # Static assets copied as-is to dist/
```

---

## Contributing

### Adding or editing a page

All documentation lives in `src/content/docs/` as `.mdx` files. Each file has frontmatter at the top:

```mdx
---
title: My Page Title
description: A short description for SEO and social sharing.
---

Page content goes here.
```

Pages are organized into sections by subdirectory (e.g. `get-started/`, `developers/`, `node-operators/`). The sidebar navigation is generated automatically from the content collection.

### Contribution workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b your-branch-name
   ```

2. **Make your changes** — edit MDX files, add pages, or update components.

3. **Test locally** with `npm run dev` to verify the page renders correctly.

4. **Push your branch** and **open a pull request** against `main`.

5. A maintainer will review and merge. On merge, the site rebuilds and deploys automatically.

### Style notes

- Write in plain English. Avoid jargon where plain language works.
- Use sentence case for headings (not Title Case).
- Code blocks should specify a language for syntax highlighting.
- Use the `<Callout>` component for warnings, tips, and important notes.

---

## Deployment

Merging to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`), which:

1. Installs dependencies
2. Fetches live governance parameters and supported chain data
3. Builds the static site with Astro
4. Builds the Pagefind search index
5. Deploys to GitHub Pages at `docs.pocket.network`

The GitHub Pages source must be set to **GitHub Actions** in the repository settings (Settings → Pages → Source).
