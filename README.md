# qev

Local decision models playing Quake in the browser through [Qwasm](https://github.com/GMH-Code/Qwasm).

**[Play qev](https://robtandy.github.io/qev/)** — choose a model, then Start or Step. Model inference runs on your device.

## Build and run

Requires Node.js 22+, [rustup](https://rustup.rs/), Python 3, Git, `make`, and `unzip`. Tested in Chrome.

```sh
git clone https://github.com/robtandy/qev.git
cd qev
npm ci --ignore-scripts
npm run setup:kevala
npm run setup:engine
npm run build:engine
npm run setup:demo
npm run serve
```

Open **http://127.0.0.1:8090/**. Choose **Kev** or **Laya** to load it, then **Start**.
**Stop** freezes the world; **Step** runs one decision; **Reset** restarts the current level stopped,
keeping the model and settings. Gameplay has sound. The default is map 6 on Nightmare.
See [How it works](#how-it-works) for the control policy and perception limits; the same policy is included in exported traces.

Demo/Emscripten setup downloads verified assets and its toolchain into ignored `build/`.
Kevala's generated Wasm/compiler artifacts stay in ignored `node_modules/`; rustup manages its pinned toolchain.
The Git repository contains no game files, model weights, or compiled engine. The Pages site
publishes the generated engine and verified free demo separately, with notices and corresponding
source downloads. Models download only on selection and cache in your browser. After local setup,
just run `npm run serve`.

Kevala is built from pinned upstream revision **`e250209`** with Rust 1.95.0, replacing the older
npm runtime (both happen to be labeled 0.1.3). There is only one runtime, with revisioned asset
URLs; existing Laya/Kev Q8 weights stay fixed. See [runtime build and validation](docs/kevala-runtime.md).
After a fresh `npm ci`, run `npm run setup:kevala` again.

## GitHub Pages

Pushes to `main` deploy **https://robtandy.github.io/qev/** through GitHub Actions. The workflow
runs tests, builds the normal engine, verifies the LibreQuake demo, assembles `build/site/`, and
checks the actual `/qev/` static layout in muted Chrome before uploading it. No evaluation engine,
weights, local assets, captures, or logs are deployed. Every action is pinned to a commit.

After the local setup above, preview the same artifact with:

```sh
npm run build:pages
npm run preview:pages   # http://127.0.0.1:8092/qev/
```

The **Licenses** link provides notices and downloadable GPL engine/gamecode source.
See [deployment, asset boundaries and verification](docs/pages-deployment.md).

## How it works

The goal is **WIN**: defeat enemies and reach the exit alive, not camp indefinitely. Reorder priorities beside Decisions; changing them stops play.
There is one controller: HUD/inventory, renderer-labelled visible pixels and surfaces,
stereo sound captions, scoreboard progress, unsuccessful own-movement feedback, and memory of
actual observations—not GPS or hidden-world probes.
The model answers **one action question**, not separate enemy, pickup or weapon questions.
qev samples its full tactic distribution once, without temperature or top-k adjustments.
Original SDK answers and the draw remain inspectable. With user-approved automatic assistance:

- Targeted combat uses the **nearest visible active enemy**; pickup approach uses the **nearest visible pickup**.
- Nearness uses actual distance to renderer-confirmed objects only. Coordinates and measured
  distances never leave the native selector or enter model input; there is no through-wall targeting.
- Equipment uses a fixed **strongest loaded owned weapon** priority: lightning, rocket launcher,
  grenade launcher, super nailgun, nailgun, double shotgun, shotgun, axe. This is not a safety,
  splash or range optimizer. Switch-ammo minimums and normal native fallback still apply.

Bindings refresh when applying a decision and are recorded separately from model answers.
Once a command starts it does not retarget. No valid visible target means rejection, not a
replacement tactic or redraw. Keeping a held gun sends no switch press and never consumes a
separate action. The action question retains the full HUD inventory, ammo pools and held weapon’s
reach. Code also assists visible-pixel aiming, relative movement, jumping and swimming, without
pathfinding or a tactical shortlist/danger veto. **Engage** advances with the axe;
**Hold position and attack** stays stationary. Visible death/corpse poses end aimed enemy attacks;
downed zombies remain uncertain. Releasing pixel aim or finishing an explicit look-up/down command
eases pitch back to level, without retargeting or adding movement/fire. Active look commands take priority, and Stop
freezes recovery too. See [weapon/death awareness](docs/weapon-and-death-awareness.md) and
[sampling and view recovery](docs/sampling-and-view-recovery.md). The current
[single-question / automatic-binding contract](docs/automatic-bindings.md) supersedes the old
multi-head target/equipment sampling. Up to four inference questions become one; this does not
by itself establish a Pixel frame-rate or latency improvement.

Five decision cards expose exact requests, responses and outcomes. Labels are not RGB/audio
recognition, and perception/navigation remain limited. The model can make poor choices or
get stuck; this is not human-equivalent play or a survival benchmark.

### If Auto is too slow

Live answers must arrive within **60 game ticks** (about 1 second at 1×) **and 1,500 wall ms**.
After three consecutive deadline misses, Auto stops with an explanation rather than retrying
indefinitely. **Step** keeps the world frozen during inference. **Copy diagnostics**, beside
Export trace, produces a small timing/rejection report instead of the full trace's repeated payloads.
Lower Speed does not extend the wall deadline.

The worker now starts before inspector rendering, and catch-up callbacks upload only their final
frame while retaining every physics/render step. Neither change establishes a Pixel speedup.
See [mobile performance, diagnostics and validation](docs/mobile-performance.md).

### Validate gameplay, not just commands

```sh
npm test
node scripts/browser-smoke.mjs --model
npm run test:gameplay -- --model=laya --runs=3 --seconds=60
npm run test:gameplay -- --model=kev-0.8b --runs=3 --seconds=60
```

The gameplay test uses a separate instrumented engine, real models, map 6 pinned to Hard
(so results stay comparable with earlier runs, although the app now defaults to Nightmare),
and muted browser output. It requires confirmed kills, actual movement, attacking, no long
stalls, and survival. It **fails** if the player merely spends ammunition, camps, or dies.
Test-only motion measurements are never supplied to the model. Reports/screenshots stay in
ignored `build/gameplay/`. See [validation results and limitations](docs/gameplay-validation.md);
passing unit/smoke tests does not establish good play.

See [implementation details](docs/implementation.md) and the [state/action contract](docs/state-and-actions.md).
