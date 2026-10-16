# Current Kevala runtime

qev replaces the old npm runtime with **one** pinned upstream revision:

- Source: [`e250209f507f8a9a17d9a24fb8c6e197424890c3`](https://github.com/bvolpato/kevala/tree/e250209f507f8a9a17d9a24fb8c6e197424890c3).
- Upstream package version still says **0.1.3**. That label alone does not identify this code;
  the published npm 0.1.3 package is older.
- `package.json` names the immutable commit archive, and `package-lock.json` pins its integrity.
- Rust **1.95.0**, the upstream pinned toolchain; Cargo builds with `--locked`.
- `scripts/kevala-runtime.mjs` pins the production-source digest, including JS, Rust/WGSL,
  manifests, licenses and the upstream build/ABI-check scripts.

There is no old-runtime selector, bundled old SDK, live-CDN import or fallback to the older npm
release. The base/SIMD/relaxed-SIMD Wasm flavors are hardware variants of this **same** revision.
The neighboring Kevala/Tetris working tree is not used or modified.

## Reproduce

Install Node.js 22+ and [rustup](https://rustup.rs/), then:

```sh
npm ci --ignore-scripts
npm run setup:kevala
```

`setup:kevala` verifies installed source **before** executing upstream code, installs/selects
Rust 1.95.0 without changing the global default, and runs the unmodified upstream
`scripts/build-wasm.sh`. It builds all three flavors with the upstream flags/profile, checks
that each is valid Wasm and exposes every function used by the JS runtime, and verifies the
source again afterward.

Generated Wasm and compiler artifacts stay in ignored `node_modules/kevala/`. The verified
build manifest is ignored `build/kevala-runtime.json`. A matching build can be reused; force a
rebuild with `npm run setup:kevala -- --force`. Missing/stale source or compiled output fails
closed; neither the development CLI nor Pages silently substitutes another SDK.

CI performs the same build. `build:pages` checks the source identity, revision, toolchain marker
and all three binary hashes before packaging. The deployment manifest retains that provenance.
Only runtime `.js`/`.wasm`, the Apache license and third-party notices are deployed—not the
upstream checkout, Rust compiler/cache, model weights or test diagnostics. No generated binary
is committed to Git.

## Cache-safe URLs and inspection

All runtime imports, worker modules and Wasm resolve under:

```
vendor/kevala/e250209f507f8a9a17d9a24fb8c6e197424890c3/
```

The old unversioned runtime entry is not served. This avoids combining new JS with an old
cached worker/Wasm whose package version happens to be identical. Model-ready status includes
`e250209`; **Copy diagnostics** and the full **version-17 trace** include the runtime revision.
Compact diagnostics summarize GPU kernel calibration (method, load-time duration, truncation
and generic/wide selection counts). These are **load-time calibration choices**, not per-decision
GPU operation counts, inference time or Pixel FPS. Full SDK information remains in the records.

## Same model packs, new runtime

`src/kevala-runtime.js` explicitly retains the existing public Q8 weight packs to isolate this
runtime change. The new upstream bare Kev model name would otherwise select a different
checkpoint and default to BF16. qev does neither.

| Model | Checkpoint revision | Pack bytes | SHA-256 |
| --- | --- | ---: | --- |
| Laya | `1c5edc17a7acd8701df6fc341c0d179f1c62c982` | 478,886,720 | `b9cab75c38f026236b8d736377aa40f889d842c219d37da45cc06c782395555c` |
| Kev-0.8B | `54f4f8777356cd5bbbb6c6919c657f26e6f2f6d8` | 857,259,584 | `8c4859f55d38b29bb5a024791b781f9ed978bd90f88ce9bce16219bd4461eca2` |

Both are from immutable pack repository revision
`e75a06d9329e19fe879f44cfcce33914fb96dade`. Load options specify Q8 and the pack/hash, with no
checkpoint-conversion fallback if that pack is unavailable. Startup still downloads no model;
selection is required. Upstream cache-identity changes may cause a one-time download even when
an older runtime had cached the same weights.

## What changes—and what does not

The updated runtime provides tiled attention alternatives and measured generic/wide matrix
kernel selection. `gpuKernel: "auto"` is explicit. The default submission policy remains
unchanged; this update does **not** also switch to a latency-first submission mode.

The action question, full eligible tactic menu, input text, automatic visible-only bindings,
weapon priority, original SDK replies, full-distribution sampling, game physics, rendering
settings and freshness guards are unchanged. Raw SDK probabilities from the new execution are
retained, not rewritten to match prior GPU outputs; small numerical differences between kernel
implementations remain possible.

A successful runtime/protocol check is not evidence of good gameplay or a particular speedup.
Desktop WebGPU and narrow-viewport checks are **not Pixel measurements**. The unchanged live
budget still requires both at most 60 game ticks and at most 1,500 wall ms.

## Validation

```sh
npm test
npm run check
node scripts/browser-smoke.mjs --model
npm run build:pages
npm run test:pages -- --model=all --recenter
npm run test:pages -- --model=laya --backend=wasm
```

The upgrade passed **423 unit/native tests** and **175 muted browser checks**, plus project-path
checks of both real models on WebGPU and real Laya on CPU/Wasm. An independent clean install/build
produced identical hashes for all three Wasm flavors. These are functional checks, not a Pixel
benchmark or a sustained-gameplay pass.

Browser harnesses verify `--mute-audio` before loading any app page. Tests cover source/lock/build
mismatches, missing/modified Wasm, symlinks, current-only asset paths, no unsolicited model
loads, cancellation/retry, unchanged pack identity, categorical sampling and normal frozen/live
execution. Real Laya still passes the four crowded token cases (509/510/508/510) and all 84
instruction/option canaries. Real Laya and Kev load their retained Q8 packs on WebGPU and execute
sampled frozen Steps. GPU calibration and real-model outputs are saved only in ignored `build/`.
