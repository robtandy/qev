# GitHub Pages deployment

Project site: **https://robtandy.github.io/Qev/**. `.github/workflows/pages.yml` deploys
pushes to `main` and supports manual dispatch. Repository Pages settings use **GitHub Actions**,
not a branch containing committed binaries. The `github-pages` environment records deployments.

## Build and preview

Requires Node.js 22+, Git, Python 3, make, unzip and tar. From a fresh checkout:

```sh
npm ci --ignore-scripts
npm run setup:engine
npm run build:engine
npm run setup:demo
npm run build:pages
npm run preview:pages
```

Open `http://127.0.0.1:8092/Qev/`. This preview serves **only** `build/site/`, not the development
server's dynamic source/vendor/demo mounts. It intentionally gives `/src/`, `/engine/` and `/demo/`
at the domain root no aliases. `src/paths.js` resolves runtime assets against the application
directory; HTML links are relative. Kevala's module workers/Wasm resolve alongside its copied
runtime. No custom response headers, cross-origin-isolation workaround or service worker is needed.
HTTPS on Pages (or localhost for preview) provides a secure context for WebGPU and integrity checks.
The CPU/Wasm backend is still available through the ordinary backend selector.

The workflow installs the lockfile with lifecycle scripts disabled, runs unit/syntax tests, builds
with pinned Emscripten 3.1.74, installs and verifies the pinned LibreQuake release, packages the site,
and runs the muted-Chrome static smoke test before upload/deploy. Third-party Actions use full
commit pins. Build permission is read-only; only the deployment job gets `pages: write` and
`id-token: write`. Concurrent deployments are serialized.

## What is published

`build-pages.mjs` uses an allowlist, not a recursive copy of the repository or general build tree:

- Public HTML/CSS/SVG and application JavaScript.
- The installed, pinned Kevala browser JS/Wasm runtime and its Apache 2.0 license.
- Normal engine `qwasm.mjs`, `qwasm.wasm`, `build.json`, and GPL license. The builder checks a
  native source/build-input digest and inspects the actual Wasm export table to reject the test
  evaluation engine, even if its metadata were mislabeled. The runtime retains its capability checks.
- Exactly the verified LibreQuake demo `pak0.pak`, `pak1.pak`, derived encounter `pak2.pak`, and
  `NOTICE.txt`. Verification returns bytes rather than filenames, avoiding a second unverified read.
- License texts and the corresponding-source archives below.
- `deployment.json`: Git commit, dirty-tree flag, build/dependency/source revisions, timestamp,
  and file sizes/SHA-256 hashes. CI refuses to publish a dirty working tree. Local previews may be dirty.

**Not published:** model weights, `build/engine-evaluation`, local/proprietary assets, snapshots,
logs, screenshots, gameplay traces, Git metadata, SDK caches, general `node_modules`, or secrets.
The source archives do include the specific upstream source needed for redistribution; they are
not a copy of the build/cache tree. Site output is restricted to less than 1 GB total and less than
100 MB per file. All generated artifacts remain ignored in Git.

Models download from the pinned upstream Kevala pack source only after the user selects one;
model inference and caches stay in the user's browser. Hosting on Pages does not move inference
to a server or change the controller, physics, sampling, model limits, or known gameplay weaknesses.

## Licenses and corresponding source

The in-app **Licenses** link leads to `licenses.html` and same-site source downloads:

- `sources/qev-engine.tar.gz`: the modified top-level C/header sources used by the web engine,
  generated animation metadata, Makefiles, Qev native source/patch/input manifest/build scripts,
  GNU notices, and SDL 2.30.9 source. Unrelated upstream Windows EXEs, proprietary SDK libraries,
  and QuakeWorld binaries are deliberately not included. The archive documents reproduction with
  the pinned toolchain; generally available build tools can be downloaded by its setup script.
- `sources/librequake-code.tar.gz`: release-tag `qcsrc`, notices/docs and build information at
  `d1515ca9bc01e590f2d54dc496f55c9a4ed72369` (LibreQuake v0.09-beta).
- `sources/pop-generator.tar.gz`: the registration-lump generator and GNU notices at
  `4d36d3cde335e539b73b9b60bab62e2c0b835f35`.
- `sources/manifest.json`: exact engine/source provenance.

The original demo notice is kept byte-for-byte, including its local-installer description; the
Pages distribution additionally supplies these source downloads. Artwork/models/sounds/textures
have BSD-style terms; gamecode/progs.dat/pop.lmp and the engine have GNU GPL terms. All applicable
notices remain available. No proprietary Quake game data is included. This packaging does not
change upstream licenses or model-weight terms.

## Verify a deployment

```sh
npm test
npm run check
npm run test:pages
npm run test:pages -- --model
npm run test:pages -- --url=https://robtandy.github.io/Qev/ --model --commit=FULL_COMMIT_SHA
```

Every browser harness launches and verifies Chrome's **`--mute-audio` before loading the app**;
ordinary visitors retain normal gameplay sound. Set `CHROME_PATH` if Chrome is not at the platform
default. The static test verifies project-path assets, normal engine capabilities, map 6/Hard startup
stopped without model downloads, notices/source downloads, one exact native tick, no root-path leaks,
and no JS exceptions. `--model` additionally loads real Laya in its worker and executes a sampled
frozen Step using the published inventory-aware requests. Test reports/captures stay in ignored
`build/pages-*` files; they are not uploaded.

These are functional deployment checks, **not** sustained-gameplay benchmarks. See
[gameplay validation](gameplay-validation.md) for the separate real-model results and limitations.
