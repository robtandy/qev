# Slow-device diagnostics and presentation batching

A Pixel report confirmed WebGPU was active and no command had executed. The pasted trace was
truncated before per-decision latency/error fields. It establishes neither a particular Pixel
inference time nor the rendering bottleneck. Model `loadMs` and the tiny `warmupMs` request are
**not** gameplay decision timings. The original excerpt remains local/ignored, not in source or deployment.

## Why Auto can repeatedly discard answers

Both existing freshness limits must pass:

- At most **60 simulation ticks** since observation: about **1 second at 1×**.
- At most **1,500 wall milliseconds**, independently of the Speed control.

For example, 1,200 ms / 72 ticks fails the tick limit. A 1,800 ms reply at ⅒× still fails the
wall limit even if only 11 ticks elapsed. Lowering Speed alone does not extend that wall deadline.
Epoch/session/model/generation, ownership, pause, death and completion guards also remain.

Previously the UI reported a generic discard and immediately queried again indefinitely. Now
`src/live-budget.js` provides explicit failure codes, measured ages and limits. Records keep
`replyValidation` and the latest `validation` (reply/application phase). A reply can be valid
when received yet expire before application; those checks remain separately inspectable.
The observation clock now starts when the snapshot is taken, including preparation work.

After **three consecutive age-only failures**, Auto stops and explains the deadline miss.
A fresh decision, unrelated cancellation or a new run breaks that streak. World/lifecycle changes
are not misreported as GPU slowness. No stale answer is retimestamped or executed, no alternative
tactic is chosen, and no decision is redrawn. Stop also cancels pending automatic resumption.

**Step** remains available: the whole world is frozen while the model thinks, then the original
bounded action executes. This avoids live staleness without making inference faster or secretly
changing live game speed. The app does not automatically switch model/backend or lower quality.

## Dispatch before inspector rendering

`Agent.score()` captures the exact request, history and single-flight job first, then dispatches
the model call **before** building inspector DOM/payloads. The worker can compute while the main
thread displays that already-recorded request. Inputs, model weights, probabilities and sampling
are unchanged. A display exception still waits for the issued request to settle and retains its
reply before releasing single-flight ownership; it cannot start overlapping model calls.

`preparedMs`, `submittedAfterMs` and `displayPreparedMs` distinguish preparation, dispatch and
inspector work. Display work can overlap inference, so these durations are not additive.

## Coalesce only redundant video uploads

A late browser callback can process up to six normal `Host_Frame(1/60)` calls. Previously every
one converted the 8-bit framebuffer to RGB and uploaded/presented an SDL texture, although the
browser cannot composite those intermediate frames separately inside the same synchronous callback.

For a callback with multiple ticks due, `qev_present.c/h` and the `vid_sdl.c` hook defer **only**
that conversion/upload/presentation. At the end, they present the complete latest framebuffer
once, including HUD regions and the latest palette. Early exits for Step completion, pause,
death/loading or a world transition still flush. A normal single-frame callback keeps its usual
region update; stopped diagnostic reads never draw or simulate anything.

Every simulation step, game clock/RNG call, software-rendered frame, visible-pixel attribution,
visibility-loss check, input tick and audio update still runs. Resolution, FOV, physics step,
catch-up cap, weapons and tactical input are unchanged. No hidden entities or speculative states
are introduced. This removes redundant presentation work; it does not prove that a Pixel GPU
can run Laya within the unchanged live budget.

## Copy diagnostics

**Copy diagnostics**, next to Export trace, copies a small JSON summary (or downloads
`qev-diagnostics.json` if clipboard access fails). It contains:

- Backend/GPU, pack size and separately labeled load/warm-up times.
- Current speed/world lifecycle and command counters, not enemy/world positions.
- Counts for retained history and the five latest decisions: status, controller latency,
  SDK preparation/forward/total timing, question/token counts, observation/check ticks,
  exact freshness failure codes, and bounded error text. A still-pending reply reports elapsed
  time so far (not a fabricated completed inference time).
- CPU-side native call timings and frame/upload counts over inference, when available.

The full **version-17 trace** additionally identifies the [current Kevala runtime](kevala-runtime.md) and still retains original requests, responses, probabilities, draws,
observations and automatic binding evidence. Copying the compact summary does not alter them.
The native **control capability is 9**; snapshot 5 and screen capability 4 are unchanged.

`qev_diagnostics()` is separate from `qev_snapshot()`. It reports engine-lifetime elapsed time
inside native calls, host-frame/presentation/defer counts and batching bounds. It is not CPU
utilization, GPU kernel time or actual compositor FPS. `hostMs` includes in-frame presentation
on ordinary callbacks, while a deferred flush occurs afterward; **do not add host and presentation
times**. `loopMs` covers the active native callback. Invalid time samples are counted and excluded.
These diagnostics never enter model requests/memory or influence targets, weapons or tactics.
They are not the evaluation-only movement/attack telemetry, which remains absent from normal builds.

SDK batch timing may be repeated on multiple response objects; the summary does not sum it.
Model forward includes scheduling/queue waits, not just GPU arithmetic. Full traces preserve
unrounded SDK values; compact durations are rounded only for readability.

## Validation and limits

This change passed **406 unit/native tests**, **175 muted desktop-browser checks** (including
real Laya), and project-path static-site validation with real Laya plus pitch-recovery fixtures.
Those are functional checks, not proof of successful sustained play.

- Pure freshness/budget tests cover exact boundaries, tick vs wall expiry, lifecycle distinctions,
  consecutive/duplicate/reset handling, application-time expiry, no stale sampling, untouched
  replies, and UI-error single-flight ownership. Missing timing is not inferred from warm-up.
- Native ASan/UBSan tests cover six-to-one presentation coalescing, ordinary single frames,
  early exits, finite counters, and final palette/HUD equivalence in an explicit tiny fixture.
- A muted real-engine browser fixture injected a 100 ms main-thread stall: **6 simulation ticks,
  6 visible frames, 6 host frames, 1 presentation**. The changed final game image was captured.
  This is controlled evidence of eliminated uploads, not a Pixel FPS measurement.
- Another explicitly mocked browser fixture returned three 1.8-second replies at ⅒×. All three
  expired with zero samples or commands, then Auto stopped. The same slow mock executed a frozen
  **12-tick Step**, with **zero native frames during inference**. The copied report was about 7 KB.
- Real desktop Laya/WebGPU checks still pass, including the unchanged four crowded token budgets
  (**509 / 510 / 508 / 510**) and **84** readable head/option canaries. One observed frozen decision
  was about 159 ms (393 tokens). This is not a before/after benchmark or a Pixel result.

The diagnostics/presentation change above did not modify Kevala. The subsequent
[pinned runtime replacement](kevala-runtime.md) builds current upstream code while retaining model
weights; the neighboring repository remains untouched. Pixel inference throughput and perceived
smoothness remain unverified. If Auto still stops, one stopped Step plus **Copy
diagnostics** can distinguish model time from native/inspector work without another enormous paste.
