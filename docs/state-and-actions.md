# State and action contract

## Purpose

Test a local model's **tactic decisions**, not fine mouse/keyboard execution. qev has one
`visible-assisted` controller; former assisted/raw-input modes remain removed. The user explicitly
authorized automatic nearest-visible enemy/pickup selection and strongest-loaded equipment.
These are disclosed controller decisions, not hidden model choices. See [automatic bindings](automatic-bindings.md).

The goal is **WIN**: defeat enemies and reach the exit alive. Reorderable priorities are:

1. Evade attacks while making progress; do not camp.
2. Get needed health, armor and ammo without reckless exposure.
3. Defeat active enemies with aimed fire and movement.
4. Explore for supplies, routes and the exit.

Reordering changes prompt order only and invalidates pending/scored decisions. It does not
install a tactical shortlist, survival veto or needs-based pickup optimizer.

## Evidence boundary

| Evidence | Source and limit |
| --- | --- |
| Health, armor, active ammo, four reserves, keys, weapons, powerups | HUD/inventory; not enemy stats |
| Grounded / in water / moving; ineffective-movement duration | Own-body feedback from actual physics, not predicted collision/support |
| Kills / secrets | Scoreboard counters, not hidden health or predicted kills |
| Held weapon reach, owned inventory | Static mechanics and HUD; axe is contact-only melee, not ranged |
| Visible kind and current recognized pose | Renderer/asset labels; death/corpse is distinct from downed/recovering/unknown |
| Screen position, apparent height, coverage, aim overlap, clipping | Final painted pixels, not full hidden bounding boxes or measured range |
| Growing/shrinking cues | Conservative short image history, not physical velocity or proof of approach |
| Floor-like/wall-like/ceiling/slope/sky/liquid appearance | Painted surfaces, not safe routes, cover or collision predictions |
| Sound kind, stereo pan, coarse amplitude, age | Nonzero spatialized PCM with audio access; no source location/ID or front/back inference |
| Previously seen objects | Old-view descriptions and ages, explicitly not current tracking |
| Recent outcomes / repeated views | Actual inputs, HUD deltas and coarse image signatures, not GPS or visited rooms |
| Nearest-visible marker (controller only) | Native 3D model-center distance **after** visible-pixel confirmation; no positions/ranges exported |

Never send hidden positions, enemy health/deadflags, AI intentions/cooldowns, metric ranges,
world bearings, server IDs, unseen geometry, map graphs, exit locations or hypothetical outcomes
to the model. There are no collision/cover/hazard/LOS probes or rollouts. Brush server classes
cannot reveal plain-looking walls as doors/buttons. The visible-only native distance comparison
is a narrow approved exception to the former no-distance-selection policy, not a world-state feed.

Labels are **not** RGB/audio recognition. Metadata can identify tiny/dark fragments a human
could not recognize. Rendering, classification, text limits and sampled memory lose information;
this is not human-equivalent perception. Door/sign recognition, arbitrary animations and puzzles
remain incomplete rather than being filled in from hidden state.

## Model authority and automatic bindings

Normal play sends **one** typed `action` choice in one `decideMany` request. There are no aim,
item or weapon questions. The full tactic menu includes forward/back/strafe, look left/right/up/down,
straight-ahead attack, aimed moving/stationary attack, engagement, pickup approach, jump forward,
swim up/down and wait. Attack means axe input or gunfire, not a guaranteed ranged shot/hit.

- Targeted combat requires a currently visible non-fallen enemy. It binds the nearest eligible
  enemy, not a model-selected threat. Unknown/hurt/downed zombies remain eligible; projectiles
  are danger evidence, not invented shootable enemies. Raw blind fire remains available.
- Pickup approach binds the nearest visible pickup, regardless of resource need or usefulness.
- Nearest candidates are retained in the capped six-per-group visible lists. Other entries use
  coverage order, with omitted counts. There is no hidden target or first-row fallback.
- Equipment accompanies every tactic, including wait. It uses known HUD ownership/ammunition
  and the fixed priority lightning > rocket launcher > grenade launcher > super nailgun > nailgun
  > double shotgun > shotgun > axe. Empty/unowned guns cannot win; switch-ammo minimums apply.
  A held upgraded gun may use its native one-round fallback. Unknown inventory is not invented.
  This is not an optimal range/splash/underwater-safety policy.
- **Engage nearest enemy; close in with axe** carries the explicit `meleeApproach` goal. It adds
  forward input only with the actual HUD axe. **Hold position and attack** remains stationary.

Base tactics are not filtered/reordered by health, ammunition, danger, need, repetition or
priority order. Neutral option IDs (`a0`, `a1`, …) avoid encoding duplicate tactic-name hints.
The action state retains the complete validated/deduplicated inventory, held reach and all ammo
pools. Ammo/pickups do not establish ownership; new HUD changes never rewrite historical requests.
Factored visual prose retains every capped kind/count and distinguishes unlike poses/groups/trends.
Full image measurements remain in traces. Crosshair overlap is not proof of melee contact.

Sample `action` **once** from its full named public probability distribution, in offer order,
normalizing rounding only. No temperature/top-k/p changes, greedy mixing, tactical reweighting or
retry sampling. SDK `answer.choice`, probabilities and extra fields stay unchanged; `ranking`
is inspection-only and `selectedIndex` is the sample. Typed/consistent replies and exact offered
probability keys are required. Saturated, malformed, stale or invalidated decisions do not execute.
The explicit `noul` diagnostic ranks independent tactic ratings and uses the same automatic
bindings, not extra binding questions or a fabricated categorical distribution. It is never a fallback.

Score-time automatic choices are preserved independently as `automatic` / `selectedAtScore`.
After freshness checks, application refreshes them from the current snapshot as `automaticAtApply`.
The tactic does not change and no extra randomness is consumed. No current required target means
rejection, not a substitute tactic. Once a command starts, its target stays fixed through that lease.
An already scored/rejected decision is never redrawn. Exact request, response, sample, automatic
plans and real execution remain inspectable. The [example](../examples/combat-decision.json) is
explicitly synthetic, not real inference or gameplay.

## Execution help

The executor receives bounded copied relative inputs, an automatically bound visible reference /
desired weapon and optional `meleeApproach`. It cannot accept model-authored console text.
Engagement requires an enemy-directed attack and rejects contradictory raw movement/look/jump
inputs. Each tick checks the current HUD: axe adds ordinary advance along pixel aim, gun does not.
It does not stop at an inferred contact range. `meleeApproachTicks` counts input ticks, not hits
or successful closure. Normal collision may block or punish movement.

Targeted input aims toward an actually painted pixel using camera intrinsics, at up to 720°/s.
Attack is gated by visible aim-center overlap, not a raycast. Relative movement uses normal run
input subject to Quake's own limits. Jump is one press; swimming is ordinary vertical input.
A held desired weapon sends no impulse; another gets one switch press with fire suppressed only
on that tick. Native refusal/fallback remains; no retry or replacement gun is injected mid-command.
`weaponPresses` records actual requests, not successful equips.

Target loss/overlays/world changes invalidate opaque references and release the whole command.
Current visible death/corpse appearance ends a held enemy attack without replacement. This never
reads hidden liveness or attributes a scoreboard increment to a specific actor. The command
cannot track around a wall, automatically dodge/open an unseen door or veto predicted danger.
Before a command starts, the explicitly automatic nearest binding can refresh; **during** the
lease it cannot retarget. Applied input does not prove that movement, collection or damage succeeded.

After pixel aim or explicit look-up/down releases, pitch eases toward level at 180°/simulation
second, for at most 30 ticks or 750 wall ms. No yaw, movement, attack or hidden target is added.
Active look/new pixel targets preempt recovery; Stop freezes it. Frozen Step adds no cleanup
frames, but later ordinary actions can finish leveling. `viewRecovery` exposes active/level and
cumulative pitch-changing ticks, not angles. `execution.viewRecoveryTicks` measures the observed
same-epoch window separately from action ticks; cleanup may outlast a record's action lease.

## Time, traces and evaluation

- Inspection freezes the world while scoring, then executes at most 12 ticks / 200 game ms.
- Live uses one asynchronous request, advancing world time and a 45-tick / 750-game-ms lease.
- Reject changed epoch/session/model/priority or age >60 ticks / 1.5 wall seconds. A separate
  native wall watchdog releases inputs even when simulation is slow; cleanup cannot extend them.
- Stop/Reset/transitions/focus loss/death/completion invalidate obsolete work. Reset preserves
  model/settings/history while restarting the actual map/skill, stopped.
- Memory records actual observations/outcomes; zero-input commands create no experience.
  HUD changes describe a time interval, not guaranteed causality from the selected action.
- Trace **15**, snapshot **5**, screen capability **4**, control capability **8** make the new
  boundary explicit. Old native builds are rejected, not silently reused.
- Evaluation-only aggregate motion telemetry never enters model inputs or the normal build.
  Browser harnesses launch **and verify `--mute-audio` before loading the app**; visitors retain sound.

Passing protocol/native/mock tests is not proof of reliable play. Real-model trials, native
fixtures, synthetic token budgets and desktop layout checks are reported separately. See
[gameplay validation](gameplay-validation.md), [sampling/recovery](sampling-and-view-recovery.md),
[weapon/death awareness](weapon-and-death-awareness.md) and [automatic-binding validation](automatic-bindings.md).
