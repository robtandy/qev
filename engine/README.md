# Qwasm integration source

Qev's engine bridge, visible-pixel reducer, animation annotations, camera recovery and the modifications in `qwasm.patch` are provided under the
**GNU General Public License, version 2 or (at your option) any later version**,
consistent with the Quake/Qwasm engine. They are provided without warranty.
[`COPYING`](COPYING) is the license text copied verbatim from the pinned Qwasm source.
The original Quake source is Copyright (C) 1996–1997 Id Software, Inc.; the build
retains upstream source headers and notices, including later Qwasm contributions.

## Reproduce the modified engine

- Upstream: <https://github.com/GMH-Code/Qwasm>
- Base commit: `f56b5e71e4be8effede29bae1785a5306dcc0249`
- Qev modification date: **2026-10-04** (subsequent changes are recorded in Git).
- Toolchain: Emscripten **3.1.74**.
- Source/build procedure: [`../scripts/build-engine.mjs`](../scripts/build-engine.mjs)
  and the setup instructions in [`../README.md`](../README.md).

The patch changes input ownership, world/entity lifecycle hooks and the main loop in six
upstream `WinQuake` files. Six renderer hooks (`r_main`, `d_edge`, `d_polyse`, `d_sprite`,
`d_part`, `d_scan`) attribute actually drawn pixels, including occlusion and water warp.
A thirteenth file, `snd_mix`, captures nonzero spatialized sound-channel amplitudes.
A fourteenth, `model`, associates alias assets with content-fingerprinted animation metadata
at load time; it changes no asset bytes, physics, damage or gamecode.

`qev_bridge.c/h` implement one player-observable controller: HUD/inventory, renderer/mixer
labels, bounded relative commands, visible-pixel aiming, jump/weapon presses, fixed ticks,
pause/step/live leases, SDL audio pauses and map/difficulty loading. An explicit engagement
command flag adds forward input only while the actual HUD weapon is the axe; it does not alter
stationary/raw commands or query range/routes. The shared HUD decoder accounts for standard
Quake's one-byte axe value (zero versus inventory bit 4096). Per-command approach-input ticks
remain inspectable. There is no privileged
legacy mode, GPS observation, hidden target tracking, route/LOS probe or tactical danger veto.
`qev_pixels.c/h` reduce final label coverage to visible 2D bounds/counts, aim overlap, a painted
aim point and coarse screen-region surface coverage. The reducer has no world-coordinate or
depth-buffer inputs. Labels remain a disclosed concession, not RGB/audio recognition.
`qev_animation.c/h` look up static, reviewed current-frame annotations from
`animation-labels.json`, including death/corpse and downed/recovering appearances. Generic
LibreQuake `frameN` names alone carry no such meaning. Whole-model fingerprints, byte lengths
and frame counts must match; unknown/grouped appearances abstain. No server health/deadflag,
AI intent or future frame is used.
`qev_recenter.c/h` restore pitch toward level after pixel aiming, bounded by rate, ticks and wall
time. This pure own-camera helper cannot access entities, pick a target, change yaw or keep
movement/attack held. New targets and explicit pitch commands take priority; Stop freezes it.
Only activity, boolean level confirmation and actual camera-changing tick counts are reported.
The build adds all four modules without embedding assets.
See [weapon/death awareness and provenance](../docs/weapon-and-death-awareness.md).

This repository publishes integration source, not compiled engine releases or game
assets. The build fetches the specified upstream source into ignored `build/qwasm/`,
applies the patch, and compiles it locally. Distributing a compiled engine requires
the corresponding source (upstream source, these modifications, and build scripts),
applicable notices, and compliance with the licenses of any accompanying assets or
model weights. Publishing these files does not grant rights to proprietary Quake
assets or change the separate terms of Kevala, LibreQuake, or model weights.
