# Qwasm integration and source hooks

qev pins [Qwasm](https://github.com/GMH-Code/Qwasm) commit
`f56b5e71e4be8effede29bae1785a5306dcc0249`, Emscripten 3.1.74, and Kevala npm 0.1.3.
The generated checkout under `build/qwasm` is patched/rebuilt by `scripts/build-engine.mjs`.
It is not a maintained user fork. See [implementation.md](implementation.md) for the current
API and [state-and-actions.md](state-and-actions.md) for the single-controller policy.

## Upstream findings retained in the implementation

| Source | Integration consequence |
| --- | --- |
| `WinQuake/Makefile.emscripten` | Software renderer + SDL2; qev removes upstream asset preloading and builds a modular ES module |
| `sys_sdl.c` | Replace wall-time `Host_Frame` calls with the fixed 60 Hz bridge scheduler |
| `host.c` | Avoid ordinary time filtering/minimum deltas while qev owns input; don't call extra stopped frames/RNG |
| `cl_main.c` | Gather only the input owned by the controller before sending a normal client command |
| `cl_input.c` | Movement is in `usercmd_t`; angles are in `cl.viewangles`; attack/jump and weapon impulses are serialized separately |
| `pr_edict.c` | World changes and freed entity slots invalidate old control/visible capabilities |
| `quakedef.h` | Include bridge declarations after the required engine types |
| `r_main.c` | Begin/end view attribution and identify the currently drawn entity; weapon/effects erase labels |
| `d_edge.c` | Attribute actual painted edge-solved surface spans, including brush pickups and coarse surface semantics |
| `d_polyse.c`, `d_sprite.c`, `d_part.c` | Attribute only opaque fragments that survive ordinary rendering tests; transparent texels don't occlude |
| `d_scan.c` | Remap labels with the exact displayed water warp |
| `snd_mix.c` | Observe nonzero spatialized PCM channel peaks, not server sound events or source positions |
| `model.c` | Associate exact alias assets with reviewed animation labels at load time; no asset/physics mutation |

The upstream engine is not itself an observation/control API. qev adds a narrow, versioned
bridge, not hard-coded heap offsets, a model-authored console interface, or a plugin that can
query arbitrary server entities. `world.h` exposes collision/contents primitives, but the
**controller does not use them for route, support, cover, hazard or LOS probes**.

## Input and time details

`CL_SendMove` does not consume an imagined `cmd.viewangles`; camera angles, attack/jump key
state and `in_impulse` must be set in the actual client path. `+use` registration is not proof
of a general interaction button: the reference serializes attack/jump, not a generic use bit.
There is consequently no invented model “use any door/button” command.

The ordinary host loop filters very small frame deltas and has RNG calls outside the filter.
qev must not simulate pause by repeatedly calling frames and merely suppressing input. The
fixed scheduler freezes world calls completely, resumes without accumulated wall-clock catch-up,
and scales pacing rather than changing physics step size. UI/key events still run while stopped.

Standard Quake serializes the active-weapon HUD value as one byte (`sv_main.c` /
`cl_parse.c`), unlike the full inventory bitmask. The axe's inventory bit 4096 therefore arrives
as zero. The bridge normalizes that **HUD-only** value for display, switch suppression and
engagement; it does not inspect the server's weapon field. Unknown values are not guessed as axes.

Raw relative controls do not need exact world headings. Target aiming uses only current
painted pixels plus camera intrinsics, with bounded angular rate. A private visible reference
is invalidated on any lost frame; it is never a hidden tracking identity. Standard Quake physics,
weapon behavior and damage are unchanged. The explicitly offered engagement goal adds forward
input while the actual HUD weapon is the axe; stationary/raw attacks are not rewritten. It uses
no target range or collision prediction, and the same visual-loss/death/lease guards release it.
After pixel aim or explicit model pitch input releases, the pure `qev_recenter.c/h` helper
returns pitch toward level with a bounded rate/tick/wall lease. It cannot read targets, change yaw or keep movement/fire held.
Explicit pitch commands and new targets preempt recovery; Stop freezes it without extra frames.
Only activity, level confirmation and camera-changing tick counts are exposed, not angles/headings.
Own-player displacement supplies internal teleport guards and binary movement feedback,
not a coordinate observation, navigation map or speculative safety check.
The separate user-approved nearest-target selector compares current rendered model-center
distance only after final visible pixels are confirmed. It exports a boolean marker, not
positions/ranges. `qev_nearest.c/h` cannot query the server or perform visibility/route probes;
`qev_EndView` enforces the visibility/pose gate and retains the winner in the capped list.

## Rendering and audio concessions

`qev_pixels.c/h` is a standalone reducer with no Quake/world/depth-buffer inputs. Its final
mask counts visible coverage, not hidden bounding boxes or overdraw. Native UI overlays and
unsupported render modes fail closed. Engine kind/animation/material labels are disclosed
semantic assistance; they do not prove what a human could identify from the same RGB image.
The server's door/button interaction class is not an acceptable visual feature by itself.
`qev_animation.c/h` translate fingerprinted demo assets' current rendered frame to appearance
labels because their original names are generic `frameN`. This is static metadata assistance,
not reading enemy health/deadflag or AI state. Recognized corpses end enemy-aim commands, while
unknown/downed appearances remain uncertain. See [provenance and limits](weapon-and-death-awareness.md).

The sound hook receives a sound identifier and mixed left/right amplitudes only. It has no
source entity, origin or metric distance. A silent, attenuated-away, paused or blocked signal
must not create a newly heard caption. These captions still use metadata, not speech/audio
recognition, and cannot infer front/back, occlusion or a precise source location.

## Model packing

Kevala's Laya sequences contain a question/options head and the state in a **single 512-token
sequence**, with a 192-token head budget. Multiple questions create multiple sequences; a
multi-question response aggregates `usage.input_tokens`. Normal qev play now sends just **one
action question** in one request item; targets and equipment are automatic assistance. The
explicit `noul` diagnostic still uses per-tactic request items. Verbatim states and per-question
usage remain inspectable. This creates no speculative game steps or multiple in-flight jobs. Input-limit hits are rejected, not silently treated as fully read observations.

The JS lifecycle preserves original requests/responses and samples the full public action
distribution once. Nearest-visible targets and fixed strongest-loaded equipment are recorded
separately as automatic choices, refreshed on application but never substituted mid-lease.
The original SDK argmax and probabilities stay unchanged. Rejections are never resampled or
replaced by another tactic. See [automatic bindings](automatic-bindings.md). Independent `noul` tactic ratings remain an
explicit highest-rating diagnostic, never a fallback or an invented categorical distribution.
See the [pinned Kevala API](https://github.com/bvolpato/kevala/blob/5f1a7104aa6213cbe52ff03f876b5198fe451595/js/src/index.js)
and [sequence builder](https://github.com/bvolpato/kevala/blob/5f1a7104aa6213cbe52ff03f876b5198fe451595/crates/kevala/src/sequence.rs).
Do not substitute an unversioned CDN dependency or mutate the separate Kevala/Tetris work.

## Build/distribution boundary

Game assets are separate from the GPL engine. The build embeds no resources; runtime setup uses
only the pinned, verified LibreQuake demo and retains its notices. There is no custom-asset import
fallback. Engine modification/source notices are in `engine/README.md` and `engine/COPYING`.
Publishing integration source does not authorize distributing proprietary Quake data or override
the separate terms for LibreQuake resources, Kevala or model weights.

The [Pages workflow](pages-deployment.md) publishes only an allowlisted static artifact under
`/qev/`. Runtime asset URLs resolve against the application directory, not the domain root;
workers and Wasm use the same tree without a service worker or special isolation headers.
The artifact supplies GPL engine/gamecode source downloads and notices, rejects an evaluation
engine or stale native-source digest, and never copies the general build directory or weights.

All browser validation must launch **and verify `--mute-audio` before loading the app**.
Inspect actual rendered frames and PCM without producing host sound. Test-only console bindings
are restored and never become production probes/cheat exports. Synthetic prompts and mocked
replies must remain labelled separately from real model gameplay.
