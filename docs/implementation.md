# qev implementation

qev has **one visible-assisted controller**, not separate assisted/unassisted modes.
The user-approved [automatic binding policy](automatic-bindings.md) uses nearest currently
visible targets and strongest loaded equipment. The model answers one action question.
Old GPS, route/cover probes and tactical shortlisting remain removed, including native exports. See [state-and-actions.md](state-and-actions.md) for the sensing boundary
and [qwasm-integration.md](qwasm-integration.md) for upstream hooks.

## Reproduce and publish source only

- Qwasm: `f56b5e71e4be8effede29bae1785a5306dcc0249`.
- Emscripten: **3.1.74**, SDK source `3d6d8ee910466516a53e665b86458faa81dae9ba`.
- Kevala: npm **0.1.3**, locked in `package-lock.json`.
- `scripts/build-engine.mjs` restores/reapplies 15 patched upstream files in the pinned,
  generated `build/qwasm` checkout and copies `qev_bridge.c/h`, `qev_pixels.c/h` and
  `qev_animation.c/h`, `qev_recenter.c/h`, `qev_nearest.c/h` and `qev_present.c/h` there. `animation-data.mjs` validates `engine/animation-labels.json`
  and emits the native annotation header only into the ignored build.
- The modular ES-module engine goes in ignored `build/engine/`. There is no asset preload.
- Bridge/reducer finite-number checks are compiled without fast-math. The browser tests
  exercise NaN rejection at the actual WASM boundary.

`npm run setup:demo` installs the verified LibreQuake v0.09-beta Lite bundle and generates
`qev_encounter`. The browser and server independently check exact lengths/SHA-256 and
required resources. `/demo/` serves only the fixed allowlist, including license notices;
partial/modified bundles and escaping symlinks fail closed. There is no asset picker,
manual-import fallback, original-shareware bypass, or injected registration marker.
The matching LibreQuake `pak1.pak` supplies `gfx/pop.lmp`.

The repository contains source, tests and notices, not PAKs, weights, WASM, captures or
credentials. Engine modifications are GPL-2.0-or-later; see `engine/COPYING` and
`engine/README.md`. A compiled/data release would require a separate license and
corresponding-source review. LibreQuake asset terms are not all interchangeable:
its QuakeC/program resources have different obligations from its artwork/sounds.

## Native bridge

`Engine.start()` rejects old builds: screen capability **4** and control capability **9**
are required. `qev_snapshot()` returns schema **5**, `controlMode: "visible-assisted"`.

| Export | Contract |
| --- | --- |
| `qev_snapshot()` | JSON copy of lifecycle/HUD state and permitted observations |
| `qev_diagnostics()` | Separate engine-lifetime timing/presentation counters; never model input |
| `qev_screen_version()` / `qev_control_version()` | Capability handshake |
| `qev_pause()` | Clear keys/leases, stop remaining ticks, freeze world time and game audio |
| `qev_speed(scale)` | Wall-time pacing, 0.05–1; physics remains 60 Hz |
| `qev_command(epoch,tick,ref,forward,side,up,yawRate,pitchRate,attack,jump,weapon,ticks,meleeApproach)` | Exact frozen-observation command, at most 12 ticks |
| `qev_auto()` | New real-time ownership session with neutral input |
| `qev_live_command(epoch,tick,session,ref,forward,side,up,yawRate,pitchRate,attack,jump,weapon,ticks,meleeApproach)` | Replace a live command without resetting the simulation accumulator; at most 45 ticks |
| `qev_step_frame(epoch,tick)` | Diagnostic one-frame step, not a UI button |
| `qev_new_game(map,difficulty)` | Validated map name and skill 0–3; load a new stopped episode |
| `qev_load_map(map)` | Compatibility map loader preserving actual current difficulty |
| `qev_audio_access(enabled)` | Follow the browser AudioContext's running/suspended state |
| `qev_play()` | Diagnostic ordinary engine input, not a privileged observation mode or UI option |

There is **no** assistance switch, probe export, or legacy world-coordinate action export.
Models cannot submit console commands, coordinates, raw refs or parameters: responses must
select keys from the exact offered questions. JS resolves those keys to copied parameters;
C independently validates numeric bounds, readiness, ownership, epoch/tick and visibility.

### Input execution

Movement is view-relative at **execution time**, not relative to a remembered compass heading:
normal run input (400 before Quake's ordinary server speed clamp), normalized horizontal
components. Look inputs offer 90°/s yaw and 60°/s pitch with a 180°/s raw-input bound.
Visible-pixel aiming permits 720°/s, still using painted pixels only, and clamps pitch to −70…80°.
The selected jump is pressed once, not automatically retriggered every tick.
Swim commands set ordinary vertical movement input; their effects depend on normal game physics.
The `weapon` parameter is the desired owned weapon (0 means no equipment request), concurrent
with the tactic. The current HUD is checked at execution: a held weapon causes no press; a
different one gets a single switch impulse without blocking movement/aim. Fire pauses on that
switch tick only, not indefinitely until an empty gun equips. A refused switch is not retried
within the command. Normal Quake weapon refusal/fallback rules determine what actually fires;
this is an input request, not a guarantee of equipment success. The JS automatic power/ammo
policy chooses the requested weapon; native execution does not choose another. `weaponPresses` counts actual switch inputs.

Targeted commands carry a private opaque reference minted only after actual visible coverage.
It survives uninterrupted visible frames, not occlusion or slot reuse. Each native input tick
uses the latest final label mask and a **painted pixel** nearest the visible bounds' center.
Camera intrinsics convert image error to bounded turning. Targeted firing requires a labelled
pixel at the aim center; that is not a hit/line-of-fire prediction. Blind fire remains available.

Losing sight/covering the view stops the whole targeted command, including movement and fire.
It never selects another target or continues tracking its hidden position. Raw movement is not
pretested for floor support, walls, cover or hazards. Normal collision, damage, weapon selection
and firing behavior still belong to Quake. Applying inputs is not evidence a jump succeeded,
a weapon changed, a pickup was collected or a shot hit.

### Fixed ticks and interruption

Inspection does not call `Host_Frame` while stopped: physics, game clocks and RNG stay frozen.
Step scores that frozen state, executes one bounded command, then stops. Speed affects pacing,
not physics step size. Stop can interrupt both inference and execution.

Live inference runs in a worker while the game continues. There is one outstanding batch,
no queue of obsolete observations. The last accepted command continues within its lease;
a replacement cannot pause time or reset the accumulator. Native tick expiry and a **1.5 s
wall-time watchdog** independently release inputs. JS rejects replies older than 60 game
ticks or 1.5 seconds; native application rechecks epoch, session and tick age. A rejected
replacement does not become a different action; the previous bounded command may continue.
Three consecutive age-only failures stop Auto with explicit tick/wall reasons and a compact
**Copy diagnostics** report. A stopped Step still supports slow inference without extending
live freshness. The exact request is dispatched before inspector rendering, allowing worker/UI
overlap. Catch-up callbacks retain every host/render/attribution tick but coalesce redundant SDL
uploads into a final full-frame presentation, including early exits. See [mobile performance](mobile-performance.md)
for timing semantics, single-flight error handling and validation limits.

Stop, focus/tab loss, model/backend/priority changes, map/difficulty changes, Reset, death,
and completion prevent obsolete replies from restarting play.
A same-map teleport cancels input, advances epoch and can start a new neutral Auto session.
Own-player displacement supplies this lifecycle guard and binary own-body motion feedback:
moving/stationary and the duration of actual attempted movement without translation. No position,
velocity, travelled distance or route prediction reaches the model. Neither signal chooses or
filters a tactic. Separate aggregate evaluation metrics exist only in the test build.

`Respawner` waits 750 ms after death, restarts the actual current map/skill once, and resumes
Auto only when the old inference settles and its generation/model/mode still permit it.
Stop/reordering/Reset cancel pending resumption. Inspection stays stopped. Level completion
is solely the game's intermission signal, not a score inferred from movement or kills.

## Observation adapters

### Rendering

Hooks in the ordinary software rasterizer write a private tag only when an opaque fragment
is actually painted. World/unknown surfaces, foreground weapon and particles occlude prior
labels; transparent sprite texels do not. Brush pickup spans and water warp use the real
painted coverage/remapping. Final extents are not projected 3D boxes or accumulated overdraw.

`qev_pixels.c/h` has no Quake types, world coordinates, Z-buffer access or geometry queries.
It reduces a bounded mask (1,024 tags; at most 1,280×1,024 pixels) into visible bounds/counts,
aim overlap, edge clipping, a painted aim point and 3×3 surface-label counts. Surface orientation
and material classes originate on **painted surfaces**, not hypothetical routes. Foreground
occlusion also removes surface coverage.

The bridge adds disclosed engine labels and current client-model animation cues. LibreQuake
uses generic `frameN` names, so `qev_animation.c/h` maps whole-asset fingerprints and current
rendered frame numbers to reviewed pose annotations. Meaningful single-frame MDL names are a
fallback; unrecognized/grouped animations abstain. Recognized death/corpse poses remain visible
but leave the active-enemy aim bindings and end a held targeted attack. Downed zombies remain
uncertain, not corpses. No enemy health/deadflag/AI intent is inspected. See
[weapon-and-death-awareness.md](weapon-and-death-awareness.md). Brush interaction classes are deliberately not
exposed: a plain-looking wall must not become a known door/button from server metadata.

At most six enemies, six pickups and six features are serialized, with omitted counts. The
nearest eligible enemy/pickup is retained first; the remaining slots use visible coverage.
`qev_EndView` reads client/render model-center placement only after final visible pixels and
pose eligibility are confirmed. `qev_nearest.c/h` compare squared eye-to-center distance, not
routes, hits or melee contact. Only a `nearest` boolean leaves native code, never coordinates
or measured ranges. There is no survival/resource ranking. Native refs are short-lived executor
capabilities, not model-visible actor IDs. Frame-local `e1`/`p1` names are trace bookkeeping,
not keys for additional target questions.

Stale/incomplete frames, native console/center-text/scoreboard/loading/dialog overlays and
unsupported debug/stereo rendering abstain. These measurements describe the game's render,
not recognition of a browser screenshot. Labels may identify tiny/dark fragments better than
a human could. Depth, visibility of a target's *whole* body and walkability remain uncertain.

### Sound and HUD

Mixer hooks observe nonzero spatialized PCM channel peaks, not a hidden list of sound sources.
Captions require active game/audio access and sufficient post-volume amplitude. They expose
broad sound kind, left/center/right pan, quiet/clear amplitude and game-tick age. There are no
source coordinates, actor IDs, exact ranges or front/back claims. Directions refer to when the
sound was heard, not a continuously tracked hidden source. At most eight recent kind/pan
entries are retained, four serialized for two game seconds, three summarized to the model.
These are metadata-assisted captions, not waveform recognition or a human masking model.

Health, armor, active-weapon ammo, all ammo reserves, keys, owned weapons and powerup icons
come from HUD/inventory. Grounded/water flags are disclosed own-body state, not future support
checks. Game scoreboard kills/secrets and actual own-motion feedback are also exposed. The
controller does not read level signs, console notices or arbitrary puzzle text.

### Memory

`ScreenMemory` retains at most eight samples over 45 ticks, spaced at least four ticks apart.
Size trends require three comparable images spanning at least 12 ticks. Loss, duplicate kinds,
clipping, tiny silhouettes, distortion, animation changes, fallen/downed poses, major image/shape
changes and stale gaps withhold trends.
It matches image descriptions, never native refs or server positions.

`ObservationMemory` retains at most 16 changed image descriptions and eight executed-action
outcomes over 30 game seconds. It retains observed corpse/downed descriptions and records
scoreboard kill deltas without attributing them to a particular target. It records old-view
sightings, observed HUD changes and repeated
coarse view signatures. It never updates unseen positions, asserts room identity, counts visited
cells, computes a map/route or offers a remembered target as currently aimable. Zero-input
commands do not create action experience. HUD ammo changes across weapon switches are not
misreported as ammo spent. Stop/model/priority changes preserve legitimate history; new epochs
and backward time reset it. Historical decision records retain their original evidence.

## Model requests and authority

Default: typed `choice`. One `decideMany` call contains **one action question**, covering every
structurally available tactic. No aim, item or weapon questions are computed. `automaticPlan`
records nearest-visible markers and strongest-loaded HUD equipment separately. The old
multi-head interface and weapon sampling are superseded by this explicit user request.

There is no standalone "select weapon" tactic: it previously turned keeping the shotgun into
an indefinitely repeatable no-op that displaced movement/fire. Equipment now accompanies every
tactic, including wait for a stationary switch. This changes the action interface, not the
model's scores or selected tactic.

**Engage nearest enemy; close in with axe** is an additional explicit goal, not a rewrite of
**Hold position and attack**. Its `meleeApproach` bit asks the native executor to advance while
the current HUD weapon is the axe, including switches/fallback during the command. Guns do not
receive that automatic advance. The tactic remains model-selected; target/equipment binding
is automatic. Visible-only distance picks the target, but no range/contact/route/collision test
controls engagement's forward input. The normal lease and visual loss/death guards release
movement/attack input. Bounded pitch-only recovery can follow released pixel aiming, without
extending the old command. `meleeApproachTicks` records forward-input ticks, not physical distance or hits.
Raw/non-engagement commands omit the optional bit (off); malformed or contradictory goal
inputs fail closed.

Tactic option keys are neutral (`a0`, `a1`, …), rather than internal command names. Kevala
includes these keys in the encoded option text; semantic keys such as `fire` duplicated
recent-action labels and affected repeated choices in frozen-input diagnostics. The record's
`optionId` maps the SDK's untouched answer/probabilities to its original tactic. All options,
descriptions, observation history and priorities remain available; sampling never rewrites the
model's original answer or applies tactical reweighting.

The normal request carries the exact shared state with its one action question. Laya internally
tokenizes questions independently, so removing auxiliary questions removes their inference
sequences. Usage remains per question, not a misleading aggregate. Its 192-token head budget
includes instructions and option descriptions; the 512-token limit includes head **and state**.

Compact shared prose groups equivalent visible descriptions and surface regions, with full
individual contact side/vertical/apparent-size/pose/crosshair/clipping cues retained in traces.
Attack bindings cover non-fallen enemies, not corpses or projectiles; raw blind fire is still
available. `weapons.js` supplies static reach/strength/switch-ammo facts and a full owned-inventory
list to the action state. It sees actual held equipment, all ammo pools and all validated owned weapons. Ammo/pickups do not imply ownership. New pickups
and resets update the next request; an unsuccessful switch does not become a held-weapon fact.
Equipment is now a fixed loaded-power priority (lightning through axe), respecting ownership,
known ammo and switch minimums. It is not a range/splash/underwater-safety optimizer. Empty
weapons remain inventory evidence, not candidates for automatic selection. Complete visible
measurements and separate automatic choices remain in the record. This is lossy, disclosed text perception, not raw video/audio.
Crowded synthetic 18-object/all-eight-weapon tests cover loaded, empty, one-round and axe-held
inventories; 84 action instruction/option extension canaries check that the head does not silently truncate.
Identical visual attributes are factored across kinds, preserving every capped kind/count and
keeping unlike groups/pose/trend descriptions separate. Redundant prose is shortened, not
priorities, ownership facts or uncertainty. Runtime input-limit hits fail closed with
the original response and a warning retained; they do not silently execute truncated decisions.

`resolveSelection()` samples only the tactic, once from its full public distribution, then binds
automatic targets/equipment for inspection. `sampling.js` uses inverse CDF in offer order,
normalizing only rounding: no temperature, top-k/p, greedy mixing or tactical filtering. Each draw,
interval, total and option ID is recorded. The SDK argmax (including rounded ties) and original
probabilities/extra fields remain untouched. `ranking` is informational; `selectedIndex` is the
sampled tactic. Applied/rejected/stale decisions are never redrawn or tactically replaced.
Invalid action replies or missing/contradictory required nearest markers reject the command.
Automatic target/equipment choices have no SDK answers or draws. Agent preserves `selectedAtScore`
and refreshes bindings against current observations at application as `automaticAtApply`, without
changing the tactic. Targets are fixed once a lease begins; visible loss/death ends the command,
not an automatic replacement. Cards show the sampled tactic probability and both automatic plans
in Observation & outcome, separately from untouched raw replies.

The explicit `noul` comparison uses per-tactic ratings and the same automatic bindings, with no
binding questions/draws. Its tactic remains highest-rating, since independent ratings are not
a categorical distribution. It is never a fallback. Larger batches can expire or fail; comparison reports preserve that fact
rather than loosening control guards or inventing successful actions.

### Returning the view to level

`qev_recenter.c/h` has no entity/world access. Executed pixel aiming or explicit model look-up/down
owns pitch until its command ends; loss/death/expiry or an ordinary replacement arms a 180°/s return
toward zero, bounded to 30 ticks or 750 wall ms. This changes no yaw, movement, firing, equipment or
target. New pixel targets and active look-up/down commands preempt recovery; accepted but unexecuted
camera commands acquire no new recovery obligation. Stop suspends it,
manual control/transitions forget it. Frozen Step adds no frames; its next ordinary command can
finish leveling. The world-local cumulative `viewRecovery.ticks` and boolean `active`/`level`
report own-camera execution only, not angles, headings or target range. The observed record-window
delta is `execution.viewRecoveryTicks`; cleanup can outlast the old action lease. These fields
are not added to model request text. See [sampling and view recovery](sampling-and-view-recovery.md).

## UI, trace and loading

Default: `lq_e0m6`, Hard (`2`), stopped and silent, no model selected. Choosing Kev/Laya loads it
immediately, with progress/cancellation and no confirmation or automatic start. Empty selection,
backend changes without a model and Start without a choice do not download default weights.
Late/cancelled loads cannot install themselves or overlap another job.

Controls: Start, Stop, Step, Reset, Speed. Map/skill changes immediately load a stopped episode.
Reset uses the actual active map/skill, preserving model/backend, speed, priorities and historical
cards. Priorities reorder the exact numbered WIN prompt only; they do not filter offers.
The setup row contains map, difficulty, model and backend choices; the explanation button and
its popup/modal have been removed. Controller policy and perception limits remain documented in
the README and included in exported traces.

Five keyed cards, newest first, preserve expansion, payload scroll and focus until eviction.
No premature verdict during inference; Accepted does not imply successful gameplay. Exact state,
requests, responses and outcome are inserted as text, not HTML. Identical submitted states are
shown once verbatim; different baseline states remain an ordered list. Copy uses that card's
payload; old cards never become executable. History retains at most 50 records.

Exports are **version 16**: compact diagnostics and reply/application freshness evidence, plus the single control policy, active/per-record priorities, original requests
and responses, action `sampling` ledger, separate automatic score/application plans, `selectedAtScore`,
resolved `selection` / `weaponSelection` with automatic method identifiers, full
observations, image/history evidence, application age, actual input-tick accounting,
`weaponPresses`, `meleeApproachTicks` and separate `viewRecovery` feedback. No GPS/route telemetry. The observation window
may outlast the lease; HUD deltas are observations since application, not causal predictions.

Audio initializes silent. Trusted Start/Step/`N` unlock Web Audio independently of inference;
refusal is reported without preventing Stop. Native pause/loading suppress output, and an audio
resume promise cannot resume gameplay. SDL resampling can produce finite floats slightly beyond
unity before Web Audio output clipping; tests do not alter game audio to force a normalized range.

## Validation and limits

```sh
npm test
npm run check
npm run build:engine
node scripts/browser-smoke.mjs
node scripts/browser-smoke.mjs --model --trial
npm run test:gameplay -- --model=laya --runs=3 --seconds=60
npm run test:gameplay -- --model=kev-0.8b --runs=3 --seconds=60
# Optional, independent longer episodes / format diagnostics:
node scripts/browser-smoke.mjs --explore
node scripts/browser-smoke.mjs --compare
```

**Every browser harness launches and verifies `--mute-audio` before loading the app.**
Tests inspect real PCM and rendered frames without audible host output. Native reducer tests use
ASan/UBSan, including coverage, clipping, holes, warp, painted aim points and surface occlusion.
JS tests poison privileged fields, cover exact protocol/priority permutations and lifecycle races.
Browser checks exercise real SDL, target disappearance/reacquisition, unsupported frames, owned
concurrent equipment switches, held-weapon no-op suppression, execution-time HUD rechecks,
firing after a switch, visible dying/corpse transitions, attack completion/stale-target rejection,
melee facts after a real switch, explicit engagement advance versus stationary/ranged attacks,
engagement's execution-time HUD recheck, malformed-goal rejection, jumping, input bounds,
loading, UI/keyboard/touch, Reset and
automatic respawn. Native annotation tests also use ASan/UBSan and audit the installed pinned
MDLs against SHA-256 and the production lookup; one-byte changes must abstain.
Swim input is wired/tested structurally, not a demonstrated general swimming/navigation policy.

`browser-gameplay.mjs` uses an explicitly separate `--evaluation` engine build. Its guarded
`qev_evaluation` export reports aggregate movement, never coordinates, and is absent from the
normal build. The app/agent never calls it. The harness records real scoreboard kills, motion,
attack input, stalls, death and all model records. `gameplay-report.mjs` fails missing telemetry,
stationary firing, knockback-only movement, no attacking, long stalls, death and model errors.
No God mode or scripted tactical substitutions are used. The user's current policy samples the
full action distribution, with automatic bindings; historical multi-head/top-choice trials are marked separately. Failed trials
remain failures, even when unit/browser smoke tests pass. See [gameplay-validation.md](gameplay-validation.md).

Synthetic budgets and mocked lifecycle decisions are labelled as such. Optional live trials are
single independent episodes, not matched replays, survival-rate estimates or proof of improvement.
Real Laya can still repeatedly choose ineffective tactics. Keeping its current weapon no longer
consumes a separate action or suppresses the independently chosen tactic.
There is no RGB/audio recognizer, reliable door/sign understanding, semantic task planner,
automatic gap/ledge traversal, puzzle solver, global navigation or completion guarantee.
