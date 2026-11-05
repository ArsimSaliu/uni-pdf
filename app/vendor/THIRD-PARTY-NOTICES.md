# Third-party software in uni-pdf

uni-pdf itself is released into the public domain (see `LICENSE` in the repository root). It bundles the third-party components below, which keep their own licences. Every copy of uni-pdf (the website, the offline download and forks) must keep this folder's licence files.

| Component | Files | Licence | Licence text |
|---|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174, © Mozilla Foundation | `pdf.min.js`, `pdf.worker.min.js` | Apache-2.0 | `PDFJS-LICENSE` |
| [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1, © 2019 Andrew Dillon | `pdf-lib.min.js` | MIT | `PDF-LIB-LICENSE.md` |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) (fork of [fontkit](https://github.com/foliojs/fontkit), © 2014 Devon Govett) | `fontkit.umd.min.js` | MIT | below |
| [Inter](https://rsms.me/inter/) variable font, © 2016 The Inter Project Authors | `fonts/inter-*.woff2` | SIL Open Font License 1.1 | `INTER-LICENSE.txt` |
| [Lucide](https://lucide.dev) icons, © Lucide Icons and Contributors | inline in `../index.html` | ISC | `LUCIDE-LICENSE.txt` |
| [DejaVu Sans](https://dejavu-fonts.github.io/) fonts (based on Bitstream Vera, © 2003 Bitstream, Inc.; Arev glyphs © 2006 Tavmjong Bah) | `dejavu-fonts.js` | Bitstream Vera / Arev font licence; DejaVu changes public domain | `DEJAVU-LICENSE` |

The two minified bundles also contain smaller libraries that were compiled into them, all under permissive licences:

- `pdf-lib.min.js`: [pako](https://github.com/nodeca/pako) (MIT, with zlib-licensed parts), [tslib](https://github.com/microsoft/tslib) (© Microsoft, Apache-2.0 / 0BSD, notice kept in the file), [@pdf-lib/standard-fonts](https://github.com/Hopding/standard-fonts) (MIT), [@pdf-lib/upng](https://github.com/Hopding/upng) (MIT).
- `fontkit.umd.min.js`: [restructure](https://github.com/foliojs/restructure), [unicode-properties](https://github.com/foliojs/unicode-properties), [unicode-trie](https://github.com/foliojs/unicode-trie), [dfa](https://github.com/foliojs/dfa), [brotli.js](https://github.com/foliojs/brotli.js), [tiny-inflate](https://github.com/foliojs/tiny-inflate) (© Devon Govett), [pako](https://github.com/nodeca/pako), [clone](https://github.com/pvorb/clone), [deep-equal](https://github.com/inspect-js/node-deep-equal), [base64-js](https://github.com/beatgammit/base64-js). All MIT, except pako's zlib-licensed parts.

"Bitstream Vera" is a trademark of Bitstream, Inc. The DejaVu fonts are bundled unmodified. Exported PDFs embed subsets of them, which the font licence permits.

---

## MIT License (fontkit, @pdf-lib/fontkit and the MIT-licensed libraries listed above)

Copyright (c) 2014 Devon Govett (fontkit and the foliojs libraries)
Copyright (c) 2019 Andrew Dillon (@pdf-lib/fontkit, @pdf-lib/standard-fonts, @pdf-lib/upng)
Copyright (C) 2014-2017 Vitaly Puzrin and Andrei Tuputcyn (pako)
Copyright © 2011-2015 Paul Vorburger (clone)
Copyright (c) 2012, 2013, 2014 James Halliday, 2009 Thomas Robinson (deep-equal)
Copyright (c) 2014 Jameson Little (base64-js)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## zlib License (parts of pako)

(C) 1995-2013 Jean-loup Gailly and Mark Adler

This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
