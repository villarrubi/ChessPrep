# Stockfish 18 Lite corresponding source

ChessPrep vendors these unmodified files from npm package `stockfish@18.0.8`:

- `stockfish-18-lite-single.js`
- `stockfish-18-lite-single.wasm`

Package tarball:

- URL: `https://registry.npmjs.org/stockfish/-/stockfish-18.0.8.tgz`
- npm integrity: `sha512-z+f2UMPXLylDBGjv9e9zU8QulY7hUl8MYHesLRrdddewlOXjJrUSmtNmbtID1/F72EPhq0CCkCNxgWS5MQVWtQ==`
- JS SHA-256: `5243FD9B276CAB7DFE3AD1D43AB9EAD73568FAC76468C614242977A210C4A391`
- WASM SHA-256: `A8FBC05EC6920B56D7485826DCB02C5FFD2826BCBF751CF973046F237A9096F1`

## Exact corresponding source

The npm registry metadata for `stockfish@18.0.8` identifies this exact source
revision:

- Project: <https://github.com/nmrugg/stockfish.js>
- Commit: [`93c994592dcf3b4b21052ab925e9b534df9c0918`](https://github.com/nmrugg/stockfish.js/commit/93c994592dcf3b4b21052ab925e9b534df9c0918)
- Local source archive: [`source/stockfish.js-18.0.8-source.tar.gz`](source/stockfish.js-18.0.8-source.tar.gz)
- Source archive SHA-256: `BB9E37A886E7E53B6E5699769A68A4A271138BF5438510EB2D08A284F232CA51`

The local archive was produced directly from that commit with `git archive`.
It includes the Stockfish engine source, the WebAssembly integration, build
scripts, notices and license. The source identifies the upstream engine as
Stockfish 18, tag `sf_18`, commit
[`cb3d4ee9b47d0c5aae855b12379378ea1439675c`](https://github.com/official-stockfish/Stockfish/commit/cb3d4ee9b47d0c5aae855b12379378ea1439675c).

The lite build embeds neural network `nn-9067e33176e8.nnue`, credited by the
unmodified loader to Linmiao Xu (`linrock`). The build script obtains and
verifies that named network before compiling it into WebAssembly.

## Build information

- Required compiler documented upstream: Emscripten `3.1.7`.
- Lite single-threaded build command: `node build.js --single-threaded --lite -f`.
- The npm publishing scripts in the source revision prepare the distributable
  JavaScript loader included in package `stockfish@18.0.8`.
- The archived revision contains UglifyJS `3.17.4` as a build-time minifier.
  Its BSD-2-Clause notice is available in [`UGLIFYJS-LICENSE.txt`](UGLIFYJS-LICENSE.txt).

The files are distributed under GPL-3.0. See `COPYING.txt` for the full
license. ChessPrep does not modify the vendored engine files. The GPL and this
source archive are offered from the same public server and at no additional
charge whenever ChessPrep distributes the JavaScript/WebAssembly binaries.
