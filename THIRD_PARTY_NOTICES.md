# Third-Party Notices

This file records third-party software bundled by Blockbench MCP and the source snapshots used to derive compatibility metadata. The project's own license remains GPL-3.0-only.

## jsonc-parser 3.3.1

`jsonc-parser` is bundled to parse and make targeted edits to JSON-with-comments files while preserving unrelated text.

The MIT License (MIT)

Copyright (c) Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## OpenYSM compatibility catalog

`lib/molang/catalog.generated.json` contains generated symbol names, relative source paths, version labels, and SHA-256 provenance digests derived from two user-supplied, read-only Java source snapshots. It does not contain their Java source code or model assets.

- Stable compatibility target: OpenYSM `2.6.5-forge+mc1.20.1`, whose supplied source snapshot declares the MIT License and Copyright (c) 2026 OpenYSM.
- Experimental comparison target: Yes Steve Model `3.0-dev-forge+mc1.20.1`, whose supplied source snapshot declares the Apache License 2.0. Development-only symbols are marked experimental and are not presented as stable behavior.

The generated catalog retains per-file hashes so its provenance can be checked against the exact audited snapshots without redistributing those snapshots.
