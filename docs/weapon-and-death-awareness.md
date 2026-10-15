# Weapon reach and visible enemy death

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
These changes introduced no tactical replacement. In a subsequent user-approved change,
choice heads are now sampled rather than always taking the SDK argmax, while preserving original
responses and a replayable draw ledger. See [sampling and view recovery](sampling-and-view-recovery.md). Sustained-play results are kept separately in [gameplay-validation.md](gameplay-validation.md).

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
Every offered weapon also retains its reach, ammunition fact and held marker. Empty and held
weapons are not filtered; a failed switch is reported, not treated as a successful equip.
Tactic labels say **attack**, not universally **fire**: the native attack button can swing an
axe or fire a gun. Legacy internal `fire` / `forward-fire` IDs and the `fire` input bit remain
stable; they do not assert a ranged shot or a hit.

No entity distance, in-range flag, hit test, raycast, or future projectile simulation is added.
Apparent size is not depth, and crosshair overlap **does not establish melee contact**. A model
can still choose an ineffective stationary axe swing; the executor does not secretly advance
or choose a gun instead for **Hold position and attack** or raw attacks.

### Complete inventory and best-weapon guidance (user-approved follow-up)

The user requested the best weapon and confirmed **Keep weapon sampling**, rather than making
weapons an argmax exception. Previously, only the equipment question listed all owned guns;
other questions saw just the held weapon and ammo totals. The shared state now includes:

```text
HUD: ... held axe (contact-only melee, not ranged), no ammo needed; shells/nails/rockets/cells 20/80/8/0; ...
Owned weapons: axe, shotgun, double shotgun, nailgun, super nailgun, grenade launcher, rocket launcher, lightning. Use best loaded gun; axe last resort.
```

The list uses the same validated, deduplicated HUD entries as the equipment offers. Ammo or a
visible weapon pickup does **not** establish ownership. A real pickup changes the next inventory;
historical requests remain unchanged. Empty/missing inventory is reported as **not reported**,
not guessed from ammunition. Single-weapon inventories remain visible without an artificial
weapon question. The held marker describes actual equipment, not a refused requested switch.

The equipment question asks for the strongest effective loaded gun, considering reach and
self-harm. Static descriptions distinguish the weak axe and stronger double shotgun/super
nailgun. With only one shell/nail, those upgrades warn that switching needs two; already-held
one-round weapons can still fire their ordinary native fallback. This is game-rule knowledge,
not a server-weapon check, range oracle, fixed weapon ranking or ammo veto.

**Sampling is unchanged**, including lower-rated, held and empty options. Instructions cannot
guarantee that the model rates the best weapon highest or that sampling selects it. Neither
scores nor probabilities are rewritten, and no rejected draw is retried with a better gun.

To fit Laya's fixed context, shared visual prose factors repeated identical attributes, e.g.
`center large attacking: grunt, ogre`. Every capped kind/count remains; unlike groups and
pose/trend descriptions are not merged. Individual geometry stays in target heads/traces.
Redundant prompt wording is shortened without dropping priorities, inventory or uncertainty.
Crowded all-eight-weapon tests cover loaded, empty, one-round and axe-held inventories; all
question/option extension canaries must remain readable. Runtime limit hits still fail closed.

### Explicit engagement (user-approved follow-up)

Because stronger range wording alone did not correct recorded distant-target axe choices, the
user approved an explicit **Engage: aim and attack, close in with axe** action. It is offered alongside,
not instead of, stationary attack. Only this choice carries `params.meleeApproach: true`:

- Enemy and concurrent weapon selections come from their explicit model distributions. Raw
  SDK argmax/probabilities are preserved alongside the samples; no tactical replacement is made.
- Each execution tick checks the **current HUD weapon**. With the axe, ordinary forward input
  accompanies visible-pixel aim and the normal attack button. With a gun, engagement attacks
  without that advance. A delayed/refused switch or native fallback does not freeze the behavior
  to what was held when scoring.
- There is no distance/contact oracle or pathfinder. It advances for the bounded lease, subject
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
**active-enemy aim affordance** is removed. Unknown/hurt/downed enemies remain eligible; no
nearest/weakest/best-target ranking is introduced. Raw fire, movement and equipment choices remain.

A held targeted attack ends with `Chosen enemy is visibly dead or dying.` when that appearance
becomes visible. The whole command releases; no other enemy is substituted. A response scored
while the target appeared alive is rejected if the current rendered pose has since fallen.
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
  unchanged lower-ranked weapon sampling, and lossless factoring of visible descriptions.
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
- `scripts/browser-screen.mjs`: real-Laya per-head budgets and **176** instruction/option
  canaries across four full-inventory/ammunition cases; no silent clipping to make descriptions fit.
- `scripts/browser-controller.mjs` also checks that a real double-shotgun pickup appears in every
  subsequent question's inventory while the pre-pickup request remains unchanged. This is a native
  input/renderer fixture, not a model-controlled pickup or a skill benchmark.

All browser checks launch and verify `--mute-audio` before the app loads. Normal gameplay still
supports sound. The normal engine requires screen capability **3**, control capability **7**;
exported traces are version **14**. Reload the app after rebuilding the engine.
