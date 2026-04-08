import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

/**
 * FIX 2: Rehype plugin — wraps every <pre> block produced by Shiki in the
 * .code-block structure defined in tokens-and-components.css:
 *   <div class="code-block">
 *     <div class="code-block-header">
 *       <span class="code-lang">LANG</span>
 *       <button class="code-copy-btn">...</button>
 *     </div>
 *     <pre>...</pre>           ← original Shiki output
 *   </div>
 */
function rehypeCodeBlock() {
  return function (tree) {
    function makeWrapper(lang, preNode) {
      const copyBtn = {
        type: 'element',
        tagName: 'button',
        properties: {
          className: ['code-copy-btn'],
          onclick:
            "var b=this,t=b.innerHTML;navigator.clipboard.writeText(b.closest('.code-block').querySelector('code').innerText);b.textContent='Copied!';setTimeout(function(){b.innerHTML=t},1500)",
        },
        children: [
          {
            type: 'element',
            tagName: 'svg',
            properties: {
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: '2',
              width: '14',
              height: '14',
            },
            children: [
              {
                type: 'element',
                tagName: 'rect',
                properties: { x: '9', y: '9', width: '13', height: '13', rx: '2' },
                children: [],
              },
              {
                type: 'element',
                tagName: 'path',
                properties: {
                  d: 'M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
                },
                children: [],
              },
            ],
          },
          { type: 'text', value: 'Copy' },
        ],
      };

      return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['code-block'] },
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['code-block-header'] },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['code-lang'] },
                children: [{ type: 'text', value: lang }],
              },
              copyBtn,
            ],
          },
          preNode,
        ],
      };
    }

    function walk(node) {
      if (!node.children) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === 'element' && child.tagName === 'pre') {
          const lang =
            (child.properties && child.properties.dataLanguage) || '';
          node.children[i] = makeWrapper(lang, child);
          // Do not recurse into the wrapper — the original pre is already placed
        } else {
          walk(child);
        }
      }
    }

    walk(tree);
  };
}

export default defineConfig({
  site: 'https://docs.pocket.network',
  base: '/pocket-docs',
  output: 'static',
  integrations: [
    mdx(),
    sitemap(),
  ],
  markdown: {
    rehypePlugins: [rehypeCodeBlock],
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      // FIX 3: Use CSS variables for token colors so [data-theme] can drive
      // light/dark switching instead of @media (prefers-color-scheme).
      defaultColor: false,
    },
  },
});
