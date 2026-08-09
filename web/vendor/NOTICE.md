# Third-party engines and libraries

## Stockfish 18 Lite (`stockfish/stockfish-18-lite-single.*`)

- Distribution: [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) via npm `stockfish@18.0.8`
- Copyright notice: Stockfish.js © 2026 Chess.com, LLC; based on Stockfish by T. Romstad, M. Costalba, J. Kiiski, G. Linscott and other contributors
- Exact distribution source: commit [`93c994592dcf3b4b21052ab925e9b534df9c0918`](https://github.com/nmrugg/stockfish.js/commit/93c994592dcf3b4b21052ab925e9b534df9c0918), also archived locally in `stockfish/source/`
- Upstream engine: [Stockfish 18](https://github.com/official-stockfish/Stockfish/releases/tag/sf_18)
- Build: Lite, single-threaded WebAssembly, with its small NNUE network embedded
- Embedded NNUE network: `nn-9067e33176e8.nnue`, credited upstream to Linmiao Xu (`linrock`)
- License and source: GPL-3.0 (see `stockfish/COPYING.txt`, `stockfish/SOURCE.md` and the public `/licenses.html` page)
- Runs entirely in the browser as a Web Worker; no engine files are downloaded at runtime

The corresponding-source archive also contains UglifyJS `3.17.4`, used only
as a build-time minifier and distributed under BSD-2-Clause. See
`stockfish/UGLIFYJS-LICENSE.txt`.

## chess.js (`chess/chess.min.js`)

- Source: [jhlywa/chess.js](https://github.com/jhlywa/chess.js) via npm `chess.js@0.13.4`
- License: BSD-2-Clause (see `chess/LICENSE`)
