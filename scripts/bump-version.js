#!/usr/bin/env node
/* Sets the release version everywhere it appears.  node scripts/bump-version.js 1.2.0 */
'use strict';
const fs = require('fs');
const path = require('path');
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) { console.error('usage: bump-version.js X.Y.Z'); process.exit(1); }
const root = path.join(__dirname, '..');
const edit = (file, re, rep) => {
  const p = path.join(root, file);
  const s = fs.readFileSync(p, 'utf8');
  if (!re.test(s)) throw new Error(`pattern not found in ${file}`);
  fs.writeFileSync(p, s.replace(re, rep));
};
edit('app/app.js', /const VERSION = '[^']+';/, `const VERSION = '${v}';`);
edit('app/sw.js', /const CACHE = 'uni-pdf-[^']+';/, `const CACHE = 'uni-pdf-${v}';`);
edit('package.json', /"version": "[^"]+"/, `"version": "${v}"`);
console.log(`version set to ${v}. Add a CHANGELOG.md entry, commit, then: git tag v${v} && git push --tags`);
