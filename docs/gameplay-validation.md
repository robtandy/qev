# Sustained gameplay validation

## Sustained play remains **unproven** — six historical inventory-follow-up episodes failed

Unit tests and successful input application are not evidence of a competent player. The
recorded stock Laya/Kev policies have not established reliable sustained play on **lq_e0m6 / Hard**.
Do not describe this working tree as reliably navigating, clearing levels, or “kicking butt.”

The current [automatic-binding policy](automatic-bindings.md) samples only the action and uses
nearest renderer-confirmed visible targets plus fixed strongest-loaded equipment. It supersedes
both strict top-choice execution and the later multi-head target/weapon sampling. Only the native
visible selector may compare object distance; positions/ranges never enter the model. There is
no tactical reweighting, rejected-draw retry, hidden target or scripted tactic.

The sustained results below are **historical policies**, not rerun or relabeled as current results.
The new policy has passed real-engine/real-Laya smoke checks and one illustrative 12-second Hard
map-6 episode (73 applications, 2 scoreboard kills, alive at 42 health). That is not the minute-long
gate, a matched comparison or proof of improved survival. The sustained six-run gate has **not**
been rerun for automatic bindings. No reported gameplay run used God mode, extra health/ammo or
reduced skill. Native fixtures and synthetic token-budget checks are reported separately.

## Reproduce

```sh
npm run setup:demo
npm run test:gameplay -- --model=laya --runs=3 --seconds=60 --label=automatic-laya-map6
npm run test:gameplay -- --model=kev-0.8b --runs=3 --seconds=60 --label=automatic-kev-map6
```

The script builds a **separate** `build/engine-evaluation/` engine and serves it only through
an explicit evaluation harness. It does not replace `build/engine/` or expose a UI/URL switch.
Every browser launch includes and verifies `--mute-audio`. The real game, real models, native
physics and normal weapon rules run at 1× speed. Automatic respawn is disabled for each trial
so that death cannot be concealed by immediately starting a new life.

The ordinary build has no `qev_evaluation` export. Test-only aggregate translation, displacement
and input counters never enter observations/model requests or affect selection/execution.
The model may see its normal scoreboard and own-body moving/stationary/unsuccessful-input
feedback, but never coordinates, travelled distance, hidden targets, route tests or rollouts.

The test requires all of:

- At least **2 game-confirmed level kills** (the scoreboard, not shots/ammo expenditure).
- At least **60 ticks of real translation under movement input** and **128 units of maximum
  displacement**. Pressing forward against a wall or getting knocked backward is not enough.
- At least **30 native attack-input ticks**. Enemies killing each other alone is not enough.
- No stretch longer than **15 wall seconds** without translation or a confirmed kill.
- A living player at the end, actual executed model choices, and no model/controller errors.

These modest thresholds are a regression gate, not a general skill benchmark. Runs are
independent, not matched replays; inference timing and normal game dynamics vary. The level's
kill counter does not attribute every death to a particular bullet or decision.

`--report-only` permits collecting failures without a failing process exit; it does **not**
change `passed: false` or the failure list. The strict commands above exit nonzero on failure.
Each run saves snapshots, unmodified decision records, samples, screenshots and an explicit
result under ignored `build/gameplay/<label>/`. Those files/weights/assets are not published.

## Latest historical sustained results: complete inventory and best-weapon prompt guidance

The user requested better weapon use and confirmed **Keep weapon sampling**. Every question
now receives the full HUD-owned inventory and ammo pools, not merely the held weapon. Static
relative-strength/switch-ammo facts and best-effective-loaded-gun guidance are added. No fixed
ranking, greedy weapon exception, filter, score rewrite or rejected-draw retry was introduced.

Labels: `inventory-laya-map6` and `inventory-kev-map6`. Same predeclared three runs per real model,
WebGPU, Hard map 6, up to 60 seconds, normal physics/weapons, 1× speed and disabled respawns.

| Model / run | Kills | Moving-input ticks | Applied choices | End / result |
| --- | ---: | ---: | ---: | --- |
| Laya 1 | 2 | 580 | 45 | died ~19s; fail |
| Laya 2 | 1 | 283 | 24 | died ~17s; fail |
| Laya 3 | 1 | 256 | 20 | died ~10s; fail |
| Kev 1 | 4 | 1535 | 107 | died ~41s; fail |
| Kev 2 | 3 | 979 | 84 | died ~31s; fail |
| Kev 3 | 1 | 244 | 20 | died ~9s; fail |

**0/6 passed**, and both strict commands exited **1**. These independent episodes do not
establish a comparative effect on survival; all failures remain failures. In particular,
correct inventory exposure does not guarantee good weapon choices or effective navigation.

The audit checked **327 records / 300 applied choices**. All **893 actual request items**
included the complete observed inventory, held weapon/reach, four ammo totals and best-weapon
guidance. All **733 used-head draws** replayed exactly. There were **225** executed non-argmax
tactics, **89** non-argmax weapon samples and **32** other non-argmax bindings, confirming that
weapon sampling remained enabled. No audit/controller/model errors, dying/corpse aim offerings
or command substitutions were found. **21** structural/visibility rejections and **6** late
stop/death discards were retained, without alternate draws. Largest real Laya input: **452 tokens**.

Narrow frozen comparisons re-score five saved observations, not gameplay. In three axe-held /
21-shell cases, shotgun probabilities rose from 0.2424/0.3044/0.3073 to 0.4387/0.4779/0.4598,
but the axe **still ranked first**. One shotgun-held case with an owned double shotgun changed
its top weapon to the double; a double-held control kept it. These are limited prompt diagnostics,
not general accuracy or improvement claims. Sampling can still select weaker weapons regardless.

Functional checks: **362 tests**, **189 muted-browser checks**, **65 JS syntax checks**. Coverage
includes all **255** nonempty inventory subsets, no inferred ownership from ammo/pickups,
actual pickup-to-next-request updates, refused switches, and unchanged sampling. A real native
fixture picked up the double shotgun after nine ordinary forward commands; every subsequent
question gained that owned gun while the original request stayed unchanged. This was explicit
QA staging, not a model-controlled pickup or a skill benchmark.

Crowded 18-object/all-eight-weapon Laya budgets (action / aim / item / weapon):

| Inventory/ammo case | Tokens |
| --- | --- |
| Loaded | 510 / 444 / 422 / 502 |
| Empty | 511 / 445 / 423 / 510 |
| One round per ammo pool | 509 / 443 / 421 / 509 |
| Axe held, guns loaded | 511 / 445 / 423 / 503 |

All **176** head/option extension canaries remained readable. Repeated visual attributes and
redundant prompt wording were compressed, not inventories, priorities or uncertainty. Runtime
512-token hits still fail closed. Artifacts stay ignored under `build/gameplay/inventory-*/`,
`build/inventory-audit.json`, `build/inventory-frozen.json`, `build/screen-token-budget.json` and
`build/combat-awareness-native.json`. See [inventory details](weapon-and-death-awareness.md#complete-inventory-and-best-weapon-guidance-user-approved-follow-up).

## Earlier results: probability sampling and pitch recovery

Labels: `sampling-recenter-laya-map6` and `sampling-recenter-kev-map6`. Three independent runs
per real model on WebGPU, Hard map 6, up to 60 seconds, 1× speed and disabled respawns. The full
public distributions are sampled; no temperature/top-k changes, retry sampling, test driver,
scripted tactics or hidden geometry. Bounded pitch recovery follows released pixel aiming.

| Model / run | Kills | Moving-input ticks | Non-top tactic samples / applied | End / result |
| --- | ---: | ---: | ---: | --- |
| Laya 1 | 1 | 212 | 8 / 19 | died ~9s; fail |
| Laya 2 | 4 | 1749 | 119 / 188 | alive, health 25, ~61s; **pass** |
| Laya 3 | 4 | 723 | 41 / 65 | died ~25s; fail |
| Kev 1 | 2 | 779 | 58 / 67 | died ~22s; fail |
| Kev 2 | 1 | 581 | 33 / 42 | died ~15s; fail |
| Kev 3 | 1 | 328 | 23 / 28 | died ~10s; fail |

Laya's one passing episode recorded 2187 attack-input ticks, 1545.27 maximum displacement and
no progress gap above 2.77 wall seconds. This meets the modest gate for **that episode**. It does
not demonstrate navigation, completion, reliable survival or a statistically established benefit
from sampling. The other five episodes ended in death; both strict suite commands therefore
exited **1**. Short fatal episodes cannot establish a long-horizon absence of stalls.

The audit covers **432 records / 409 applied decisions**, replaying **970 used-head draws** across
426 fully sampled records. **282** executed tactics and **244** used target/equipment samples
differed from SDK argmax. Every sampled option, interval, normalizer and resolved command matched
the untouched response and offer order; no dying/corpse aim bindings, unauthorized melee advance,
resampling or controller/model errors were found. There were **17** native structural/visibility
rejections and **6** late/stop/death discards; those were not replaced with alternate draws.
World counters recorded **221** actual pitch-recovery ticks. In that historical version, explicit
model look-up/down choices retained their tilt indefinitely. The subsequent control-capability-7
fix levels their pitch after release, without overriding active looks. These earlier trials have
not been rerun or reclassified as results for the newer camera behavior.

Functional validation: **347 tests**, **183 muted-browser checks**, and **64 JS syntax checks**.
Native rendered fixtures show an elevated enemy, return to level, unchanged frozen-Step duration,
view-only cleanup after live expiry/death, and explicit-look/new-target/Stop priority. Controlled
non-argmax samples also executed through the real native command boundary. These fixtures are
not model gameplay. Crowded Laya heads remain 503/435/413/496 tokens with all 44 canaries readable;
the largest Laya question in the six actual runs was 431 tokens.

Artifacts stay ignored: `build/gameplay/sampling-recenter-*/`, `build/sampling-recenter-audit.json`,
`build/recenter-native.json`, `build/recenter-{aimed-up,level}.png`, and the current
`build/combat-awareness-native.json`. See [the selection and camera contract](sampling-and-view-recovery.md).

## Earlier top-choice results: explicit engagement and corrected axe HUD decoding

After the user approved an explicit engagement goal, **Engage: aim and attack, close in with
axe** was added alongside **Hold position and attack**. The native executor now advances only
for the declared goal when the actual HUD weapon is the axe. The one-byte axe HUD value is
normalized consistently; keeping the axe no longer sends redundant weapon impulses.

Final labels: `engage-final-laya-map6` and `engage-final-kev-map6`. Same Hard map 6, real models,
1× speed, disabled respawns and verified muted browser output; no test driver or tactical override.

| Model / run | Kills | Real moving-input ticks | Engagement choices | Melee-advance input ticks | End / result |
| --- | ---: | ---: | ---: | ---: | --- |
| Laya 1 | 4 | 156 | 30 | 84 | died ~28s; fail |
| Laya 2 | 3 | 173 | 37 | 173 | died ~29s; fail |
| Laya 3 | 4 | 109 | 27 | 71 | alive, health 43, ~61s; fail: 30.2s stall |
| Kev 1 | 2 | 273 | 0 | 0 | died ~11s; fail |
| Kev 2 | 2 | 360 | 0 | 0 | died ~12s; fail |
| Kev 3 | 2 | 445 | 0 | 0 | died ~18s; fail |

The audit covers **489 applied choices**, including **94 engagements** and **328 melee-advance
input ticks**. All **16** explicit model selections of an axe against a bound target occupying
less than 20% of the viewport height used engagement and recorded forward input, rather than
a stationary targeted swing. This describes
screen appearance and sent input, **not measured target range or a guarantee of closing the gap**.
No original SDK top choice was replaced, no dying/corpse target was offered, and no non-engagement
action acquired melee-advance input. Kev chose ordinary advancing attacks, not the engagement goal.

The recorded stationary-axe regression requests were also re-scored without advancing the game:
the final menu chose engagement for the three problematic cases and the nearby-looking control;
the two shotgun controls chose engagement with the shotgun (no automatic advance). These frozen
comparisons are narrow diagnostics, not a general accuracy or survival claim.

**The gameplay gate remains 0/6.** The tested stationary-melee cases now have closing input, but
Laya still makes poor weapon/tactic choices and unbound attacks, and both models can stall or die.
Do not claim a general survival improvement. The earlier `engage-*-map6` trial set used an unclear
goal label, never selected engagement, and also failed; it is archived, not the shipped description.

Current functional checks: **321 tests**, **176 muted-browser checks**, and 60 JS syntax checks.
Native browser evidence includes real axe-driven translation, zero held-axe switch presses,
stationary/ranged non-movement, and execution-time weapon changes. Crowded Laya heads use
503/435/413/496 tokens; all 44 head/option canaries remain readable. Actual per-run maxima were
424–463 tokens. Artifacts remain ignored under `build/gameplay/engage-final-*/`,
`build/engage-audit.json`, `build/engage-intent-frozen.json`, and `build/combat-awareness-native.json`.
Both strict gameplay commands exited 1, as required for failures.

## Earlier results: weapon reach and visible death/corpse awareness

Chrome/WebGPU on Apple Metal; default map 6, Hard, 60-second maximum episodes. Model packs:
Laya revision `1c5edc17a7acd8701df6fc341c0d179f1c62c982`; Kev-0.8B revision
`54f4f8777356cd5bbbb6c6919c657f26e6f2f6d8`.

These runs include the [weapon/death-awareness changes](weapon-and-death-awareness.md),
weapon-neutral **attack** labels, and exact top-choice execution. Output labels are
`reach-death-final-laya-map6` and `reach-death-final-kev-map6`.

| Model / run | Kills | Real moving-input ticks | Maximum displacement | End | Result |
| --- | ---: | ---: | ---: | --- | --- |
| Laya 1 | 4 | 97 | 676.57 | alive, health 92, ~61s | fail: 41.2s stall |
| Laya 2 | 4 | 165 | 880.55 | alive, health 67, ~61s | fail: 24.8s stall |
| Laya 3 | 4 | 135 | 395.20 | alive, health 30, ~61s | fail: 26.5s stall |
| Kev 1 | 1 | 243 | 1,051.10 | died, ~15s | fail: kills/death |
| Kev 2 | 3 | 370 | 1,077.57 | died, ~12s | fail: death |
| Kev 3 | 4 | 395 | 1,056.92 | died, ~13s | fail: death |

**Still 0/6 passed the full gate.** Laya moved in each of these episodes and killed enemies,
but then stalled; Kev moved and fought but died. Some Laya commands remain stationary or blind
axe attacks despite explicit contact-only reach. The supplied facts do not establish that the
model reliably uses them. These independent runs do not establish a statistical improvement.

The final trace audit covers **682 applied model choices**: no recognized dying/corpse contact
was offered in an aim binding, no SDK top choice was replaced, and all 460 applied commands scored with
the axe held included its contact-only reach in every request. **15** held attacks ended with
the native visible-death stop reason. Other endings include visual loss, replacement, expiry
and interruption; the scoreboard is not attributed to individual commands. Actual request
maxima were 423–450 tokens across these runs. The separate synthetic crowded budget was
489/435/413/496 tokens, with all 43 head/option canaries readable.

Local evidence: `build/combat-awareness-audit.json`,
`build/combat-awareness-native.json`, and `build/gameplay/reach-death-final-*/`.
Both strict gameplay commands returned exit code 1. The earlier `reach-death-*-map6` runs
(preceding the weapon-neutral label change) also failed and remain archived; they are not the
final run set. Functional validation passed 308 tests and 172 muted-browser checks, but is not
a gameplay success claim.

## Earlier results, before weapon/death awareness

Archived under `final-laya-map6` and `final-kev-map6`; these are **not** the current controller's
results. The old Laya screenshot shows repeated aiming at a pile of corpses whose generic
animation names had been reported as unknown.

| Model / run | Kills | Real moving-input ticks | Maximum displacement | End | Result |
| --- | ---: | ---: | ---: | --- | --- |
| Laya 1 | 4 | 0 | 6.74 | alive, health 72, ~60s | fail: camping/stall |
| Laya 2 | 4 | 0 | 23.45 | alive, health 16, ~60s | fail: camping/stall |
| Laya 3 | 4 | 0 | 1.66 | alive, health 94, ~60s | fail: camping/stall |
| Kev 1 | 2 | 443 | 1,072.70 | died, ~19s | fail: death |
| Kev 2 | 3 | 422 | 1,061.90 | died, ~13s | fail: death |
| Kev 3 | 3 | 560 | 1,395.28 | died, ~23s | fail: death |

**0/6 passed that earlier full gate.** Laya attacked but camped; Kev moved and attacked but died.
Both strict command invocations returned exit code 1. They were not a completed gameplay fix.

Before these changes, an independently observed baseline Laya episode killed 3 enemies but
never moved under input and died around 31 seconds. The Kev baseline backed into a wall,
then spent a minute with zero kills/attack input. These are diagnostic examples, not a
controlled performance comparison or statistical improvement claim.

## Historical changes and what their evidence establishes

- Added real sustained-play measurement rather than asserting only that an action applied.
- Normal run input replaces a walking-speed handicap; Quake still applies its normal speed cap.
- Visible-pixel aiming can turn promptly (720°/s), without world-space target knowledge.
- A refused empty-weapon switch no longer suppresses the chosen attack indefinitely. The
  switch is requested once; normal Quake refusal/fallback rules determine the equipped weapon.
- Added scoreboard progress, explicit empty-ammo descriptions, and actual unsuccessful
  own-movement feedback. These facts do not filter tactics or select substitutes.
- Clarified the active **WIN** objective and that moving-fire tactics also provide target aiming.
- Enemy target descriptions use readable screen-relative cues/current pose. Projectiles stay
  perceptual danger evidence, not invented shootable enemies.
- Weapon reach is now in every request, not just the equipment question; attacks are labelled
  as attacks rather than treating axe swings as ranged firing.
- Fingerprinted current-rendered-frame annotations fix the generic `frameN` death-detection
  gap. Corpses stay in evidence but leave active-enemy aim choices; visible death ends the held
  attack. Downed zombies remain uncertain. No hidden health/deadflag or target-distance lookup.

Several unshipped hierarchical/conditional prompt prototypes were also tested locally. Some
moved more, others camped or charged into danger; none established a reliable winning policy.
They are not production modes and are not reported as successful gameplay. Further policy/model
work is needed without tactical overrides or hidden-world information; the user's newer
sampling policy supersedes the strict top-choice contract used for these archived runs.
