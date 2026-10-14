# State and action contract

## Purpose

Test a local model's **decisions**, not fine mouse/keyboard execution. Qev now has one
player-observable setup; the former assisted and raw-input modes are removed. Mechanical
help is allowed, but it must not secretly become superior knowledge or a tactical policy.

The overall goal is **WIN**: defeat enemies and reach the exit alive, with user-reorderable priorities:

1. Evade attacks while making progress; do not camp.
2. Get needed health, armor and ammo without reckless exposure.
3. Defeat active enemies with aimed fire and movement.
4. Explore for supplies, routes and the exit.

Reordering changes prompt order only and invalidates pending/scored decisions. There is no
code-level survival-first shortlist left behind the configurable priorities.

## Evidence boundary

| Supplied evidence | Source and limit |
| --- | --- |
| Health, armor, active ammo, reserves, keys, weapons, powerups | HUD/inventory; not enemy stats |
| Grounded / in water / moving; duration of ineffective movement input | Own-body feedback from actual past physics, not a future collision/floor test |
| Kills / secrets | Game scoreboard counters, not hidden enemy health or predicted kills |
| Held/owned weapon reach and ammo requirements | Static game mechanics; axe is contact-only melee, not ranged; no measured enemy distance |
| Visible object kind and current pose, when recognized | Disclosed renderer/asset labels; recognized death/corpse versus downed/recovering; unknown appearances abstain |
| Screen side/vertical location, apparent height, visible coverage, aim overlap, clipping | Final painted pixels only; no full hidden bounding box or metric distance |
| Growing/shrinking cues | Conservative short image history, not physical velocity or guaranteed approach |
| Floor-like/wall-like/ceiling/slope/sky/liquid appearance by screen region | Painted surface semantics; not a safe route, cover test or collision prediction |
| Sound kind, stereo pan, coarse amplitude, age | Nonzero spatialized PCM channels with active audio access; no source location/ID or front/back inference |
| Previously seen objects | Old-view descriptions and ages, explicitly not current tracking |
| Recent outcomes / repeated views | Executed inputs, actual HUD deltas and coarse image signatures; not GPS, visited rooms or distance travelled |

Never supply hidden entity positions, health, AI intentions, cooldowns, exact ranges/bearings,
server IDs/generations, unseen geometry, map graphs, exit locations, predicted safety, speculative
movement results or hypothetical line of sight. No collision/cover/hazard probes or rollouts.
A brush's server class does not reveal that an ordinary-looking wall is a door or button.

Classification remains a concession: the models do **not** receive raw images/audio and the
adapters are **not** RGB/waveform recognition. Tiny/dark fragments can get labels a human could
not recognize. Surface/material names and sound identities are metadata-assisted. Rendering,
classification, text/context limits and sampled memory all lose information; this is not a
human-equivalence claim. Recognition of doors/switches, signs, arbitrary animations and puzzles
is incomplete. These gaps are disclosed rather than filled from hidden engine state.

## Model authority

The tactic menu includes forward/back/strafe, look left/right/up/down, straight-ahead attack,
moving attack, jump forward, swim up/down, and wait. Attack means an axe swing or gunfire as
appropriate to the equipped weapon; the legacy `fire` command bit is native attack input.
The additional **Engage: aim and attack, close in with axe** goal aims/attacks and advances while the
actual current HUD weapon is the axe. **Hold position and attack** remains a distinct,
stationary option. This is a declared choice, not a conversion of a stationary attack. Targeted attack/approach require
a visible enemy without a recognized death/corpse pose, or a pickup respectively. Fallen bodies
remain in the visual evidence, not the active-enemy aim choices. Pain, unknown poses and downed
zombies remain targetable. Projectiles remain visible danger evidence, not invented shootable
enemies; blind fire remains available. Weapon selection accompanies **every tactic** when multiple owned weapons
exist; it is not a standalone, turn-consuming action. All owned weapons, even empty/current
ones, remain selectable. Wait plus a different weapon permits a stationary switch.
Availability does not imply usefulness or safety.

Every permitted tactic is offered, irrespective of health, ammo, visible danger, resource need,
repetition or priority order. Visible lists have a disclosed screen-coverage cap, not tactical
ranking. No rule chooses the nearest enemy, best weapon, needed pickup, retreat route or fallback.

One `decideMany` batch asks explicit questions:

- **action**: distribution over tactics;
- **aim**: distribution over visible attack targets, if present;
- **item**: distribution over visible pickups, if present;
- **weapon**: distribution over owned weapons to hold alongside the tactic, if multiple are present.

Each question is a separate request item with the exact same shared state. Tactics use neutral
option IDs (`a0`, `a1`, …): Kevala encodes keys as text, so internal names such as `fire` must not
be duplicated as answer hints. Each recorded `optionId` maps back to the unchanged tactic;
this is not a post-score substitution or probability adjustment. Individual target
criteria use readable image-relative side/vertical position, apparent-size categories, current
pose, crosshair overlap and clipping. A few recognized enemy roles (e.g. melee knight) are static
game knowledge, not hidden AI intent. The full HUD-owned weapon inventory, all ammo pools, and
the actual held weapon's reach are in the shared state for **every** head, even with one owned
weapon. Ammo or visible pickups do not imply ownership. Each equipment option describes reach,
ammo, relevant switch minimums and held status; descriptions also distinguish relative strength.
The prompt favors the best effective loaded gun and treats the axe as a last resort. The user
explicitly kept weapon sampling: this is guidance, not an argmax exception or an automatic picker. Crosshair
overlap is explicitly not proof of melee contact. Common prose groups equivalent visual
observations, factoring identical attributes across kinds without losing counts or mixing
unlike groups/pose/trend descriptions. Full source measurements remain inspectable. See
[weapon-and-death-awareness.md](weapon-and-death-awareness.md) for asset annotations and limits.
The example in [`../examples/combat-decision.json`](../examples/combat-decision.json) is
**synthetic**, not captured gameplay or actual model scores.

Each used head is sampled once from its full public distribution, in offer order, normalizing
only rounding (no temperature or top-k/p changes). The original SDK argmax and probabilities
are untouched. The trace records each draw, interval, normalizer and sampled option separately;
`selectedIndex` is the sampled tactic, not necessarily `ranking[0]`. Unused heads consume no draws.
Rejected decisions are not resampled or replaced. The separate `noul` diagnostic ranks independent
ratings, not a made-up categorical distribution. See [sampling details](sampling-and-view-recovery.md).

The sampled tactic's target binding and concurrent weapon sample are used. Keeping the held
weapon leaves the tactic intact; it cannot turn movement/combat into a weapon-only no-op.
Independent heads are not a joint calibrated policy: a model can still choose an ineffective
combination. Unknown keys, invalid probabilities, a missing relevant binding (including equipment
for movement/wait) or an input-limit hit reject the whole decision.
The exact submitted requests and untouched responses remain available. No automatic format
fallback, score adjustment or post-score action substitution is permitted.

## Execution help

The executor receives only copied, bounded relative inputs, the explicitly selected
visible-contact capability / desired owned weapon, and an optional `meleeApproach` goal bit.
Only the offered engagement goal sets that bit. It requires an enemy-directed attack and
rejects contradictory movement/look/jump inputs rather than blending or substituting them.
With the actual HUD axe equipped, engagement adds ordinary forward input along the visible-pixel
aim; with a gun, it does not. This is rechecked each tick, including delayed switches and native
weapon fallback. It does not estimate range or stop at an inferred contact distance; normal
collision applies, so engagement can be blocked or dangerous. It never chooses another target.
`meleeApproachTicks` counts these forward-input ticks, not successful translation or hits. It cannot accept model-authored console text.

For a targeted command, each tick aims toward an actual painted pixel using camera intrinsics.
Attack input is gated by visible aim-center overlap, not by a raycast or hit prediction.
An aligned axe swing is not a ranged shot and does not establish melee contact. Movement remains
relative to the current view, using normal run input subject to Quake's own speed limit.
Pixel aiming turns at up to 720°/s; ordinary model-selected look inputs retain their bounds.
When targeting ends, pitch eases back to level (180°/s, at most 30 ticks or 750 wall ms), without
yaw changes, movement, attack or retargeting. A new pixel target preempts this; explicit
look-up/down relinquishes automatic pitch ownership. Stop suspends cleanup. Frozen Step never
runs extra frames; subsequent ordinary actions can finish leveling. `viewRecovery` records
activity, boolean level confirmation and cumulative camera-changing ticks—not angles/headings.
`execution.viewRecoveryTicks` counts the change observed in that record's window, not action ticks.
A chosen jump is a single key press; swimming is ordinary
vertical input. Equipment is checked against the **current** HUD, not the older observation:
an already-held weapon sends no impulse; a different one gets one switch press alongside
movement/aim. Firing is suppressed on that switch tick only. A declined switch is not retried
within the command and does not indefinitely block attack. Quake's normal equipped-weapon and
automatic fallback behavior determines the result; the controller does not pick a replacement.
The model's weapon choice is a keypress request, not a guarantee that the game will equip it. `weaponPresses` records actual switch inputs, not success.

Opaque target references expire on loss of visible pixels, overlays, world changes or reuse.
The executor releases the whole command on loss. A currently visible death/corpse pose also
ends a targeted enemy attack; a reply scored before that transition rejects instead of switching
targets. This uses the rendered animation, never hidden health/deadflag or a scoreboard-to-actor
identity inference. It cannot reacquire by hidden identity, track
around a wall, change targets, automatically dodge, open an unseen door or preempt a predicted
hazard. Raw blind fire and risky movement remain available. An applied command is not proof
of success: jumping can fail, a weapon can remain unchanged, a pickup can be missed and a shot
can hit nothing.

## Time, history and evaluation

- Inspection: freeze the whole world while scoring, then apply at most 12 ticks / 200 game ms.
- Live: one asynchronous batch, world advancing, bounded 45-tick / 750-game-ms input lease.
- Reject stale epoch/session/model/priority or age >60 ticks / 1.5 wall seconds.
- A separate native wall-time watchdog releases movement/attack input even during slow simulation.
  Pitch-only cleanup has its own bounded tick/wall lease and cannot keep those inputs held.
- Stop/Reset/transitions/focus loss/death/completion invalidate obsolete work.
- Reset restarts the actual map/skill, stopped, retaining model/settings and historical cards.
- Memory contains actual sampled evidence only; no executed outcome for zero-input commands.
- HUD changes describe an observation interval, not necessarily damage caused by that action.
- Scoreboard kill deltas are progress, not proof that the chosen enemy died. Disappearance is not death.
- Memory retains corpse/downed descriptions; animation changes break apparent-size continuity.
- Traces distinguish accepted choice, actual input ticks, interruption and final observed state.

Tests with synthetic views and mocked model replies validate contracts, not decision quality.
The sustained gameplay harness requires real kills, physical movement, attack input, no long
stalls and survival. Its aggregate distance/displacement instrumentation is compiled only into
`build/engine-evaluation`, not the normal engine, and is never model evidence. A failed gameplay
run must not be described as successful because its commands executed. See
[gameplay-validation.md](gameplay-validation.md).

Short real episodes must report deaths, input expiry, rejected replies, truncation and failed
progress honestly. They are not matched replay, survival/completion rates, evidence of a human
baseline, or proof that richer perception improves the model. Persistent tasks, global navigation,
automatic obstacle/gap traversal and arbitrary puzzle solving remain future work.
