# One action question, automatic targets and equipment

This user-approved policy supersedes the former independent action/aim/item/weapon questions
and the earlier **Keep weapon sampling** preference. There is one `visible-assisted` controller,
not an additional selectable mode. Normal play calls `decideMany` with **one action question**.
The model still chooses the tactic, using one sample from its entire named public distribution.
No temperature/top-k/p changes, greedy mixing, tactical reweighting or retry sampling are added.

## Nearest currently visible object

The user approved actual distance **only for renderer-confirmed visible objects**. After final
pixel attribution, `qev_EndView` gates each candidate on visible pixels, current labels and an
uncovered view. Only then does it read current client/render placement. `qev_nearest.c/h`
compares squared 3D distance from the rendered eye to the object's model-bound midpoint
(origin plus midpoint of model bounds). This is center distance, not surface clearance,
reachable walking distance, melee contact, a hit prediction or a LOS/route probe.

- Combat binds the nearest eligible enemy; recognized dying/corpse appearances are excluded.
  Unknown/hurt/downed zombies remain possible threats, without a hidden health/deadflag query.
- Pickup approach binds the nearest visible pickup, not a health/ammo-needs optimizer.
- Ties use native slot order internally, without exporting stable entity IDs.
- The winner is retained first in the six-object cap for its group, even when tiny. Remaining
  entries keep coverage order. Visible bodies and omitted counts remain evidence.
- Only a `nearest` boolean is exported alongside existing opaque visible references. Coordinates
  and measured distances never enter JavaScript, model input or observation memory.
- Missing/contradictory markers reject a tactic that requires them; there is no first-row,
  biggest-pixel, remembered-target or through-wall fallback.

Pixel aiming still uses the chosen object's actual painted pixels and camera intrinsics,
**not its coordinates**. Targeting is not a guarantee of contact or damage.

## Fixed strongest-loaded weapon priority

`strongestLoadedWeapon()` uses validated HUD ownership and ammunition, in this declared order:

1. Lightning
2. Rocket launcher
3. Grenade launcher
4. Super nailgun
5. Nailgun
6. Double shotgun
7. Shotgun
8. Axe

This defines “most powerful” as a fixed equipment priority, not an optimal damage calculation.
It does **not** optimize range, splash safety, underwater discharge, spread or travel time.
Those native rules and consequences remain unchanged. Guns require known available ammo;
upgraded double shotgun/super nailgun need two relevant rounds when switching. Already-held
upgrades can use their native one-round fallback. Axe requires no ammo. Unowned weapons,
visible pickups and unverified ammo do not become usable equipment. No known usable owned
weapon means weapon input `0` (no invented switch).

Equipment accompanies every tactic, including wait. A singleton inventory needs no model
question either. Native execution rechecks the current HUD: keeping the held weapon sends
no impulse, switching sends one press and suppresses fire only on that tick. Refusal is not
retried mid-command or reported as success. The complete owned inventory, all four ammo pools,
and actual held weapon's reach remain in the model's action state.

## Timing, sampling and traces

At score time, `automaticPlan` records the available automatic bindings independently of the
model answer. `resolveSelection` samples only `action`. At application, after existing
session/epoch/age guards, `Agent` refreshes the target and weapon against the current snapshot.
This can change a binding while inference was running, **not the sampled tactic**. For example,
“attack nearest enemy” can bind a different current nearest enemy than at score time.

Once a native command begins, its target is fixed for that bounded lease. Disappearance or
visible death stops it without mid-lease replacement. If no valid current target remains at
application, reject without another tactic/draw. Stop freezes everything; Step adds no frames.
Pitch recovery, movement limits, normal damage/weapons, native ammo fallback and game physics
are unchanged. Engagement still adds advance only while the actual HUD weapon is the axe;
stationary and raw attacks do not gain movement.

Current trace **17**, snapshot **5**, screen capability **4**, control capability **9**
(the original automatic-binding release used trace 15/control 8):

- `requests` / `responses`: actual single action question and unchanged SDK reply/extras.
- `sampling.heads.action`: full original distribution's replayable draw, interval and SDK choice.
- `automatic`: score-time policy, epoch/tick/frame, nearest bindings and loaded-weapon choice.
- `selectedAtScore`: immutable score-time resolved command.
- `automaticAtApply`: fresh application-time binding evidence, including unsuccessful attempts.
- `selected`: resolved command with automatic `selection` / `weaponSelection` methods, **no fake
  SDK target/equipment answers or sampling draws**. Existing execution counters record real inputs.

Cards label automatic equipment and expose both plans in Observation & outcome. `noul` remains
an explicit diagnostic with per-tactic ratings; it uses the same automatic bindings, no binding
questions/draws, and is never an automatic fallback.

## Validation and performance limits

The measurements below are from the initial automatic-binding release. Subsequent deadline
handling, dispatch/presentation optimizations and compact diagnostics are documented separately
in [mobile performance](mobile-performance.md), with the later [Kevala runtime update](kevala-runtime.md)
validated separately. None is a Pixel benchmark.

- Native nearest-selector tests use ASan/UBSan, including hidden/unreadable coordinates,
  3D ordering, ties, invalid numbers and frame reset. Integration tests check the final-pixel
  gate and capped-list retention. Poisoned getters prove JS/model construction does not read ranges.
- Tests cover non-first/tiny nearest objects, corpse/stale/hidden rejection, fresh application
  binding, no mid-lease replacement, all inventory subsets, power order, empty/unowned/unknown
  ammo, switch minimums, one action draw, untouched replies and rejection without redraw.
- Muted real-engine browser fixtures cover visibility loss, overlays, native switches and
  structural rejection, pickup inventory changes, engagement and pitch recovery. Explicit native
  axe inputs are labeled fixtures, not falsely represented as automatic/model equipment choices.
- Real desktop Chrome **Laya/WebGPU** validation used one request per decision. Four synthetic
  crowded/all-eight-weapon cases used **509 / 510 / 508 / 510** tokens, with **84** readable
  action instruction/option extension canaries. Runtime 512-token hits still reject.
- The observed frozen real-model Step took about **141 ms**; three short live fixture decisions
  took **149.5–162.3 ms**. These are desktop samples, **not Pixel measurements or a controlled
  before/after latency comparison**.
- A separate illustrative 12-second normal Hard map-6 Laya episode applied 73 decisions and
  ended alive at 42 health with two scoreboard kills. It is not the sustained gameplay gate, a survival estimate or proof
  of better play. Historical multi-head gameplay results are not relabeled as current results.

Reducing up to four independently scored questions to one reduces inference work **per decision**.
The live loop may consequently make decisions more often; overall GPU utilization need not fall. It does not
establish a particular latency multiplier or prove that Pixel rendering is now smooth. No
resolution, physics, rendering cadence, decision-age guard or pinned Kevala dependency was changed
by the automatic-binding simplification.
