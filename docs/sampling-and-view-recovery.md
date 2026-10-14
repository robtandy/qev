# Probability sampling and return to level view

Two user-approved changes supersede the earlier strict top-choice policy and retained-pitch
behavior. They do not add tactical filters, hidden geometry, target substitutions or a second
controller. Earlier top-choice gameplay reports remain historical evidence, not sampling trials.

## Sample the model's distributions

`src/sampling.js` implements full categorical (inverse-CDF) sampling. The default controller
uses one uniform `Math.random()` draw per **used choice head**, in this order:

1. Tactic (`action`).
2. Its target (`aim` or `item`), only if the sampled tactic requires that binding.
3. Concurrent equipment (`weapon`), only if multiple owned weapons were offered.

Even a one-option head records its draw. An absent equipment question does not acquire an
invented answer/draw; native weapon `0` still means no switch request. Unused answers remain
in the exact response but cannot add a target to a movement or change a tactic into an attack.
The heads remain independent model questions, **not a jointly calibrated policy**.

In the later best-weapon/inventory follow-up, the user explicitly chose **Keep weapon sampling**.
All heads now receive the full owned inventory and ammunition, with best-effective-loaded-gun /
axe-last-resort guidance. Weapons are still sampled; there is no argmax exemption, probability
rewrite or fixed best-weapon picker. See [inventory details](weapon-and-death-awareness.md#complete-inventory-and-best-weapon-guidance-user-approved-follow-up).

For probabilities in offer order, compute the cumulative sum divided by their total. Select
the half-open interval `[lower, upper)` containing the draw. This normalizes only the rounding
in the SDK's public, named `answer.probabilities`; it never changes the original object. No
temperature adjustment, top-k/p, greedy mixing, tactical reweighting, tail truncation or
rejection sampling is applied. Zero-weight choices cannot be sampled. Undocumented positional
`raw_probabilities` extras are retained but not substituted for the named public distribution.

Validation is still strict: typed answers, exact offered keys, finite nonnegative probabilities,
positive total near one within the existing rounding tolerance, and a valid SDK argmax consistent
with its returned distribution. Invalid, saturated, cancelled or stale scoring results cannot
execute. Malformed used bindings reject the whole sampled decision. No alternate enemy, gun
or tactic is substituted, and **a rejected application is never redrawn**. A new observation and
new scoring request are required. Stop/Step do not draw again from an already scored decision.

The SDK's `answer.choice` remains its original argmax, including rounded ties. It can legitimately
differ from the executed sample. `rankDecision()` still validates/ranks the original response for
inspection, not execution. `resolveSelection()` samples the tactic and required bindings exactly
once per record; even partially rejected records cannot be sampled again. The explicit `noul`
diagnostic retains highest-rating tactic selection: its independent favorable ratings are not
silently misrepresented as categorical probabilities. Its choice-type binding heads are sampled.
There is no automatic format fallback or production argmax selector.

### Inspect and reproduce a selection

Trace version **13** records `samplingMethod: "categorical-v1"`. Each scored record has
`sampling.complete` and `sampling.heads`, with these fields for every used choice head:

- `question`, `responseIndex`, and `options` in their original offer order;
- `sdkChoice` (unchanged argmax) and `optionId` / `index` (the actual sampled choice);
- `draw` in `[0, 1)`, the selected half-open `interval`, `probability` (original weight),
  `totalProbability`, and `normalizedProbability` (weight / total).

`selectedIndex` and `selected` refer to the sample, **not `ranking[0]`**. Target and equipment
selections also carry their sampling metadata; their copied `answer.choice` remains the SDK's
answer and can differ from their selected `id`. The cards label completed choice decisions
**sampled**. Exact responses still show the original answers; **Observation & outcome** contains
the sampling ledger and resolved command. The displayed percentage is the model's tactic
probability, not the probability of the whole composite decision.

To replay a draw, take the original answer at `responseIndex`, order its named weights using
`options`, and call `sampleDistribution(weights, () => draw)`. It must select the recorded index
and interval. No RNG seed or knowledge of the browser's private PRNG state is needed for this
per-decision audit. It is not a deterministic replay of game physics or model timing.

The checked-in `examples/combat-decision.json` uses explicitly illustrative probabilities and
fixed draws: Engage is sampled instead of the SDK's top back-fire. It is not captured gameplay.
Lifecycle/native fixtures use one-hot mock distributions; nontrivial distributions, boundaries,
rounded ties, tiny tails, invalid RNG values and non-argmax execution have separate tests.

## Return pitch to level after pixel aiming

The previous pixel servo wrote `cl.viewangles[PITCH]`, but release only cleared the held keys.
Aiming at an elevated enemy therefore left the player looking up during later ordinary actions.

`engine/qev_recenter.c/h` is a small camera-ownership state machine with no engine/entity/world
access. After pixel-guided targeting ends (including item aiming), it returns **pitch** toward
zero, at up to **180°/game second**. One cleanup is bounded by **30 simulation ticks or 750 wall
milliseconds**, whichever is reached first. This is own-camera assistance, not a distance,
horizon-image, LOS or route query. It changes neither yaw nor movement, attack, jump or equipment.

- Current target loss, visible death and lease expiry release the target command and arm cleanup.
  The old movement/fire lease is not extended. Live time may continue with only camera cleanup.
- An accepted ordinary move, turn, raw attack or wait can finish pitch recovery from previous
  targeting. It does not choose where to walk or whom to attack.
- A new pixel target takes priority immediately, with no intervening pitch reset.
- Explicit look-up/down commands cancel automatic pitch ownership; their deliberate view is not
  immediately undone. A later pixel-aiming command can take ownership again.
- Stop suspends recovery without moving the frozen view. A frozen Step never runs extra frames:
  its subsequent ordinary action can finish leveling. Neutral maintenance frames do not arm it.
- Manual play, death, completion, teleport and world changes do not inherit active camera cleanup.
- Slow simulation can reach the wall-time bound before level. Another ordinary model command
  may finish; there is no unbounded background input or abrupt snap to bypass the watchdog.

Snapshot `viewRecovery` exposes `active`, a boolean `level` confirmation, and cumulative actual
pitch-changing `ticks` within the world. It contains no pitch angle, heading, target position or
range and is not added to model request text. `execution.viewRecoveryTicks` is the observed
counter change in that record's window, **not extra action ticks, movement or hits**. A record
may finish before all idle cleanup does; later snapshots retain the cumulative count. World
changes/absent counters abstain rather than inventing a cross-epoch execution delta.

The normal engine now requires screen capability **3**, control capability **6**. Snapshot
schema remains **4**; trace export is **13**. Rebuild the engine and reload the app/reselect the
model so old code cannot silently retain the earlier behavior.

## Validation boundary

- `tests/sampling.test.mjs`: deterministic distribution coverage/replay, non-argmax tactic +
  target + equipment, untouched responses, used-head accounting, no redraw on rejection,
  stale/token-limit guards, and actual Agent score/Step/live lifecycles.
- `tests/recenter.c` / `tests/recenter.test.mjs`: ASan/UBSan, every native pitch from −70° to
  +80°, monotonic/rate-bounded recovery, zero overshoot, target/look/Stop priority, tick/wall
  watchdogs, cumulative counters and independent observed-window accounting.
- `scripts/browser-controller.mjs`: native execution of controlled non-argmax choices; a real
  rendered death releases attack and restores level without another model command.
- `scripts/browser-recenter.mjs`: actual elevated visible enemy, image-space aiming, frozen
  Step accounting, live expiry recovery, explicit look and new-target priority, and Stop.
  Screenshots and evidence stay under ignored `build/recenter-*`.
- The existing muted-browser model checks retain per-head token budgets and canaries. Gameplay
  tests still use real models, Hard map 6, normal physics/weapons, 1× speed and disabled respawns.

Functional fixtures are not evidence of reliable navigation/survival. Sampling can select poor
low-probability actions as well as useful alternatives; there is no claim it improves skill.
See [gameplay-validation.md](gameplay-validation.md) for independent real-play results.
