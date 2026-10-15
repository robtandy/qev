# Weapon reach and visible enemy death

**Current policy:** [one action question with automatic bindings](automatic-bindings.md).
The reach/death fixes below remain; historical multi-head sampling has since been replaced
by nearest-visible targets and a fixed strongest-loaded weapon priority.

## Why the earlier cues were insufficient

Two concrete gaps were found in the controller input:

1. The axe/contact rule appeared only in the **weapon question**. Independent tactic/aim
   questions did not receive that question's instructions. A refused empty-shotgun request
   could leave the actual HUD weapon as the axe while the model continued choosing stationary
   fire without an explicit reach description in its tactic input.
2. LibreQuake v0.09-beta Lite's monster MDLs mostly name their frames `frame1`, `frame2`, etc.
   Looking for `death` in those names returned `unknown`, even for visible corpses. The previous
   map-6 traces include repeated aimed attacks at large, generic-labelled fallen models.

These are information/affordance fixes, not evidence that a stock model now plays well.
These changes initially introduced no tactical replacement. A later change introduced full
distribution sampling; the current controller samples only the action and records approved
automatic target/equipment choices separately, preserving original responses and the draw ledger. See [sampling and view recovery](sampling-and-view-recovery.md). Sustained-play results are kept separately in [gameplay-validation.md](gameplay-validation.md).

## Static weapon knowledge, not target-distance telemetry

`src/weapons.js` is a small, shared description table:

| Weapon | Reach/handling evidence |
| --- | --- |
| Axe | Weak contact-only melee, **not ranged**; no ammunition required |
| Shotgun | Ranged pellets; spread reduces effectiveness at distance |
| Double shotgun | Stronger ranged spread, best close up; requires 2 shells to switch to it |
| Nailgun / super nailgun | Ranged projectiles with travel time; super nails are stronger and require 2 nails to switch |
| Grenade launcher | Ranged arcing explosives, with self-splash risk |
| Rocket launcher | Ranged explosives, with self-splash risk |
| Lightning | Limited-length ranged beam; hazardous in water |

The **actual held weapon from the current HUD** and its reach description appear in the shared
state of every request, even if there is only one owned weapon and no equipment question.
The **complete owned inventory** and all ammo-pool counts now accompany it in every question,
not only the equipment head. See the inventory follow-up below.
The static profiles retain each weapon's reach/ammo/switch facts. Empty and held weapons remain
in inventory evidence; automatic selection skips unusable guns. A refused switch is reported,
not treated as a successful equip.
Tactic labels say **attack**, not universally **fire**: the native attack button can swing an
axe or fire a gun. Legacy internal `fire` / `forward-fire` IDs and the `fire` input bit remain
stable; they do not assert a ranged shot or a hit.

No entity distance, in-range flag, hit test, raycast or future simulation enters model input.
The separate approved native selector compares distance only to renderer-confirmed visible
objects, exporting a marker rather than coordinates/ranges. Apparent size is not depth, and
crosshair overlap **does not establish melee contact**. Stationary/raw attacks never gain
secret advance; their equipment follows the same disclosed automatic policy as other tactics.

### Complete inventory and best-weapon guidance (user-approved follow-up)

The earlier inventory follow-up kept weapon sampling. The subsequent request for automatic
strongest-loaded equipment supersedes that preference and removes the equipment question.
The single action state still retains all owned guns, not just held equipment and ammo totals:

```text
HUD: ... held axe (contact-only melee, not ranged), no ammo needed; shells/nails/rockets/cells 20/80/8/0; ...
Owned weapons: axe, shotgun, double shotgun, nailgun, super nailgun, grenade launcher, rocket launcher, lightning. Strongest loaded weapon auto.
```

The list uses the same validated, deduplicated HUD entries as automatic equipment selection. Ammo or a
visible weapon pickup does **not** establish ownership. A real pickup changes the next inventory;
historical requests remain unchanged. Empty/missing inventory is reported as **not reported**,
not guessed from ammunition. Single-weapon inventories remain visible without an artificial
weapon question. The held marker describes actual equipment, not a refused requested switch.

Automatic equipment follows lightning > rocket launcher > grenade launcher > super nailgun >
nailgun > double shotgun > shotgun > axe, using known owned/loaded weapons. This is a declared
power order, **not** an optimal range/self-harm/underwater-safety policy. Double shotgun and
super nailgun require two relevant rounds to switch; already-held one-round upgrades can use
their native fallback. This uses static rules and HUD ammo, not server weapon state.

Only **action** is sampled. Equipment has no fake model probabilities or draw. Native execution
rechecks the current held weapon to avoid redundant impulses; refusal is not retried mid-command.

To fit Laya's fixed context, shared visual prose factors repeated identical attributes, e.g.
`center large attacking: grunt, ogre`. Every capped kind/count remains; unlike groups and
pose/trend descriptions are not merged. Individual image measurements stay in traces.
Redundant prompt wording is shortened without dropping priorities, inventory or uncertainty.
Crowded all-eight-weapon tests cover loaded, empty, one-round and axe-held inventories; all
question/option extension canaries must remain readable. Runtime limit hits still fail closed.

### Explicit engagement (user-approved follow-up)

Because stronger range wording alone did not correct recorded distant-target axe choices, the
user approved an explicit engagement action, now labeled **Engage nearest enemy; close in with axe**. It is offered alongside,
not instead of, stationary attack. Only this choice carries `params.meleeApproach: true`:

- The tactic comes from the sampled action distribution. Enemy and concurrent weapon bindings
  are now automatic, recorded separately from the unchanged SDK action answer/probabilities.
- Each execution tick checks the **current HUD weapon**. With the axe, ordinary forward input
  accompanies visible-pixel aim and the normal attack button. With a gun, engagement attacks
  without that advance. A delayed/refused switch or native fallback does not freeze the behavior
  to what was held when scoring.
- Advance has no contact/range oracle or pathfinder. Native distance chooses only the visible
  target; it does not decide when contact is achieved. Engagement advances for its lease, subject
  to actual collisions, and may be blocked or unsafe. Reaching/contacting/killing is not guaranteed.
- Visual loss, visible death, Stop and the existing tick/wall leases release movement/attack;
  no replacement target or gun is selected by code. Bounded pitch-only return to level can follow
  pixel aiming; explicit look/new targets take priority, and Stop freezes recovery too.
- `execution.meleeApproachTicks` records forward-input ticks, not successful physical movement.
  Other attacks retain their existing movement semantics. Conflicting goal/raw inputs reject.

Native validation also found a HUD decoding bug: standard Quake's one-byte active-weapon value
encodes `IT_AXE` (inventory bit 4096) as zero. A shared HUD-only decoder now normalizes that value
for display, equipped-weapon comparison and engagement. Keeping an already-held axe no longer
sends redundant switch impulses. No server equipment field is read. Normal Quake range, spread, collision, ammunition and damage rules apply.

The public reference mechanics are in LibreQuake's pinned
[`qcsrc/weapons.qc`](https://github.com/lavenderdotpet/LibreQuake/blob/v0.09-beta/qcsrc/weapons.qc).
The descriptions do not turn those known weapon rules into exact target-range measurements.

## Current rendered appearance, not hidden liveness

`engine/animation-labels.json` annotates **26 exact demo model assets**, including severed-head
models. Frame intervals are inclusive and zero-based. Animation names/order come from the pinned
[LibreQuake v0.09-beta gamecode](https://github.com/lavenderdotpet/LibreQuake/tree/v0.09-beta/qcsrc/monsters);
the manifest names each source file and records each MDL's SHA-256, byte count, frame count and
whole-file FNV-1a-64 identity.

The `model.c` load hook associates recognized assets with these annotations. It does **not**
rewrite MDLs, animation data, gamecode, health, damage or physics. The renderer asks the pure
`qev_animation.c` lookup about the **current client-rendered frame**, never a server's next
frame/think/attack, health or dead flag. Final painted pixels and the ordinary current-view
guards still determine whether any label/ref is observable.

FNV is a fast content-identity check, **not a security boundary**; the app independently validates
the complete demo PAKs with SHA-256. Filenames or frame counts alone never enable an asset map.
Changed/unrecognized assets get no numeric-frame mapping. Meaningful MDL names can still label
single frames; generic names abstain. Grouped-frame names abstain because the old loader records
the last subframe's name, not necessarily the subframe currently drawn.

The important distinctions are:

- `death`: a recognized dying animation, not an active-enemy aim target.
- `dead`: a recognized terminal corpse or severed-head appearance, not an active-enemy aim target.
- `downed`: the zombie's falling/lying/recovering sequence; **may revive**, not declared dead.
- `hurt`: pain animation, not death.
- `unknown`: no supported interpretation; not assumed dead or harmless.

Ambiguous Shub shaking and the spawn's dangerous explosion frame remain unknown rather than
being invented as harmless corpses. These labels are disclosed **renderer/asset assistance**, not
RGB recognition or proof that a human would recognize a tiny/partially occluded/dark fragment.

## Target lifetime and memory

Dying/corpse contacts remain in the original snapshot, visual descriptions and trace. Only the
**active-enemy aim affordance** is removed. Unknown/hurt/downed enemies remain eligible for
nearest-visible selection; there is no hidden-health/weakest-enemy ranking. Raw fire and movement remain.

A held targeted attack ends with `Chosen enemy is visibly dead or dying.` when that appearance
becomes visible. The whole held command releases; no other enemy is substituted mid-lease.
At application, before starting a new command, automatic binding refreshes to the current nearest
eligible enemy. If none remains, reject without a new tactic or draw. A direct stale corpse
reference is still rejected by native validation.
Loss of pixels still means loss of visibility, **not** knowledge of an unseen death.
Released pixel aiming and finished explicit look-up/down commands have bounded pitch-only recovery toward level, so the view does not
stay tilted toward a former target. This never retains fire/movement or selects another enemy.

Observation memory includes the visible pose, so standing-to-corpse is not an unchanged view.
It retains old corpse/downed descriptions without tracking unseen identities. Size-change
inference stops across animation changes or fallen/downed poses. Scoreboard kill deltas describe
level progress only: they do not prove that this target died or attribute every kill to this action.

## Validation

- `tests/inventory.test.mjs`: all 255 nonempty inventory subsets across shared requests,
  ammo/pickups versus ownership, new pickups/resets/refused switches, static switch requirements,
  fixed loaded-power selection for all subsets, and lossless factoring of visible descriptions.
- `tests/engagement.test.mjs`: explicit goal binding, unchanged stationary/raw choices, optional
  native command bit, malformed inputs, no range queries, and per-command execution accounting.
- `tests/combat-awareness.test.mjs`: shared reach facts, axe-only inventory, refused switches,
  corpse versus hurt/unknown/downed targets, unchanged model responses, no private range/health
  reads, stale corpse binding rejection, pose-aware memory and conservative size trends.
- `tests/animation.test.mjs` / `tests/animation.c`: ASan/UBSan, bounded frame/name handling,
  content identity, metadata validation, terminal-pose intervals, zombie recovery, and (with the
  installed demo) all 26 MDLs checked against SHA-256 and the native lookup. One-byte changes abstain.
- `scripts/browser-controller.mjs`: the actual rendered grunt death/corpse, native attack release,
  live and frozen stale-target rejection, preserved raw firing, and reach facts after a real axe
  switch. Engagement checks also prove actual axe-driven translation, no injected advance for
  stationary/ranged attacks, current-HUD behavior through a switch, and malformed-goal rejection. These are explicit fixture commands, **not model gameplay**. Evidence is written to
  ignored `build/combat-awareness-native.json` and `build/combat-awareness-corpse.png`.
- `scripts/browser-screen.mjs`: real-Laya single-action budgets and **84** instruction/option
  canaries across four full-inventory/ammunition cases; no silent clipping to make descriptions fit.
- `scripts/browser-controller.mjs` also checks that a real double-shotgun pickup appears in every
  subsequent question's inventory while the pre-pickup request remains unchanged. This is a native
  input/renderer fixture, not a model-controlled pickup or a skill benchmark.

All browser checks launch and verify `--mute-audio` before the app loads. Normal gameplay still
supports sound. The normal engine requires screen capability **4**, control capability **9**;
exported traces are version **16**. Reload the app after rebuilding the engine.
