#!/usr/bin/env node
/* Copies the bundled UI assets from node_modules into app/:
 *   - Inter variable font (latin, latin-ext, greek) → app/vendor/fonts/
 *   - Lucide icons → an inline SVG sprite inside app/index.html (between the
 *     <!-- icons:start --> and <!-- icons:end --> markers). Inline, because
 *     browsers refuse external SVG sprites on file://.
 *   node scripts/vendor-assets.js   (after npm install) */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const vendor = path.join(root, 'app', 'vendor');

// ---- font
const fonts = path.join(vendor, 'fonts');
fs.mkdirSync(fonts, { recursive: true });
for (const sub of ['latin', 'latin-ext', 'greek']) {
  fs.copyFileSync(path.join(nm, '@fontsource-variable/inter/files', `inter-${sub}-wght-normal.woff2`), path.join(fonts, `inter-${sub}.woff2`));
}
fs.copyFileSync(path.join(nm, '@fontsource-variable/inter/LICENSE'), path.join(vendor, 'INTER-LICENSE.txt'));

// ---- icons
const ICONS = [
  'library', 'folder-open', 'panel-left', 'panel-right', 'chevron-left', 'chevron-right', 'chevron-down',
  'zoom-in', 'zoom-out', 'mouse-pointer-2', 'square-dashed', 'pencil', 'highlighter', 'eraser', 'undo-2',
  'search', 'graduation-cap', 'download', 'sun', 'moon', 'monitor', 'circle-help', 'star',
  'message-circle-question-mark', 'trash-2', 'x', 'arrow-up', 'arrow-down', 'sticky-note', 'ellipsis',
  'command', 'check', 'folder', 'plus', 'file-text', 'upload', 'keyboard', 'list', 'layout-grid', 'bug',
  'scale', 'book-open', 'file-plus', 'archive-restore', 'hard-drive-download', 'copy', 'sparkles',
  'notebook-pen', 'file-down', 'arrow-left', 'info', 'rotate-ccw',
];
const symbols = ICONS.map((name) => {
  const svg = fs.readFileSync(path.join(nm, 'lucide-static/icons', name + '.svg'), 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
    .replace(/\s*\n\s*/g, '');
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
});
const sprite = '<svg xmlns="http://www.w3.org/2000/svg" class="sprite" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + symbols.join('') + '</svg>';
fs.copyFileSync(path.join(nm, 'lucide-static/LICENSE'), path.join(vendor, 'LUCIDE-LICENSE.txt'));

const index = path.join(root, 'app', 'index.html');
const html = fs.readFileSync(index, 'utf8');
const re = /<!-- icons:start -->[\s\S]*?<!-- icons:end -->/;
if (!re.test(html)) throw new Error('icon markers not found in app/index.html');
fs.writeFileSync(index, html.replace(re, `<!-- icons:start -->\n  ${sprite}\n  <!-- icons:end -->`));
console.log(`fonts copied, ${ICONS.length} icons written into app/index.html`);
