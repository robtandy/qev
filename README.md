# Qev

Local decision models playing Quake in the browser through [Qwasm](https://github.com/GMH-Code/Qwasm).

## Build and run

Requires Node.js 22+, Python 3, Git, `make`, and `unzip`. Tested in Chrome.

```sh
git clone https://github.com/robtandy/Qev.git
cd Qev
npm ci --ignore-scripts
npm run setup:engine
npm run build:engine
npm run setup:demo
npm run serve
```

Open **http://127.0.0.1:8090/**. Choose **Kev** or **Laya** to load it, then **Start**.
**Stop** freezes the world; **Step** runs one decision; **Reset** restarts the current level stopped,
keeping the model and settings. Gameplay has sound. The default is map 6 on Hard.
Hover or click **How it plays ?** for the control policy and perception limits.

Setup downloads verified LibreQuake assets and the toolchain into ignored `build/`.
No game files, weights, or compiled engine are published here. Models download only on selection
and cache locally. After setup, just run `npm run serve`.

## How it works

The goal is **WIN**: defeat enemies and reach the exit alive, not camp indefinitely. Reorder priorities beside Decisions; changing them stops play.
There is one controller: HUD/inventory, renderer-labelled visible pixels and surfaces,
stereo sound captions, scoreboard progress, unsuccessful own-movement feedback, and memory of
actual observations—not GPS or hidden-world probes.
The model scores explicit tactic and target/item/weapon questions. Qev samples each used
choice head's full probability distribution once, without temperature or top-k adjustments.
Original SDK answers remain unchanged; draws and sampled selections are inspectable.
Weapon selection accompanies
the chosen tactic, so keeping a gun never consumes a separate action. Code assists execution,
including visible-pixel aiming, movement, jumping and swimming. No tactical shortlist,
danger veto, target substitution, or tracking through walls. Every question gets the complete
HUD-owned weapon inventory, ammo pools, and held weapon’s reach (axe = contact-only melee).
The prompt favors the best effective loaded gun, with the axe as a last resort. Weapon sampling
stays on; this guidance is not a forced best-weapon picker. The explicit **Engage** action advances with
the axe, while **Hold position and attack** remains stationary; no hidden range lookup or
pathfinding is used. Visible death/corpse poses end aimed enemy attacks;
downed zombies remain uncertain. Releasing pixel aim eases pitch back to level, without
retargeting or adding movement/fire. Explicit look-up/down commands take priority, and Stop
freezes recovery too. See [weapon/death awareness](docs/weapon-and-death-awareness.md) and
[sampling and view recovery](docs/sampling-and-view-recovery.md).

Five decision cards expose exact requests, responses and outcomes. Labels are not RGB/audio
recognition, and perception/navigation remain limited. The model can make poor choices or
get stuck; this is not human-equivalent play or a survival benchmark.

### Validate gameplay, not just commands

```sh
npm test
node scripts/browser-smoke.mjs --model
npm run test:gameplay -- --model=laya --runs=3 --seconds=60
npm run test:gameplay -- --model=kev-0.8b --runs=3 --seconds=60
```

The gameplay test uses a separate instrumented engine, real models, the actual Hard level,
and muted browser output. It requires confirmed kills, actual movement, attacking, no long
stalls, and survival. It **fails** if the player merely spends ammunition, camps, or dies.
Test-only motion measurements are never supplied to the model. Reports/screenshots stay in
ignored `build/gameplay/`. See [validation results and limitations](docs/gameplay-validation.md);
passing unit/smoke tests does not establish good play.

See [implementation details](docs/implementation.md) and the [state/action contract](docs/state-and-actions.md).
