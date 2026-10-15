import { MAX_DECISION_AGE_MS, MAX_DECISION_AGE_TICKS } from "./decisions.js";
import { LIVE_MISS_LIMIT } from "./live-budget.js";

const number = n => typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
const delta = (a, b, key) => Number.isFinite(a?.[key]) && Number.isFinite(b?.[key]) && b[key] >= a[key] ? number(b[key] - a[key]) : null;

/** Small export/copy summary, not model input. Full traces keep original values,
 * replies, probabilities and all observations; this deliberately omits those. */
export function diagnosticSummary({ records = [], model = null, observation = null, native = null, speed = null, stoppedReason = null, monotonicNow = null } = {}) {
  return {
    version: 1, purpose: "Performance and decision-rejection summary; not model input or a gameplay-quality benchmark",
    speed, stoppedReason,
    limits: { maxGameTicks: MAX_DECISION_AGE_TICKS, maxWallMs: MAX_DECISION_AGE_MS, consecutiveMissesBeforeStop: LIVE_MISS_LIMIT },
    model: model ? { arch: model.arch ?? null, backend: model.backend ?? null, gpu: model.gpu ?? null,
      packBytes: model.pack?.bytes ?? null, loadMs: number(model.loadMs), warmupMs: number(model.warmupMs) } : null,
    world: observation ? { map: observation.map, difficulty: observation.difficulty, epoch: observation.epoch,
      tick: observation.tick, paused: observation.paused, alive: observation.alive,
      actionSerial: observation.actionSerial, actionTicks: observation.actionTicks } : null,
    native,
    retainedRecords: records.length,
    counts: Object.fromEntries(["discarded", "rejected", "error"].map(status => [status, records.filter(r => r.status === status).length])),
    appliedLive: records.filter(r => r.appliedAt).length,
    latest: records.slice(-5).map(r => {
      // Kevala repeats BATCH timing on each response; never sum those durations.
      const timing = r.responses?.[0]?.timing, age = r.validation;
      const forward = number(timing?.forward), total = number(timing?.total), wall = number(r.ms);
      const pending = r.status === "scoring" && !r.responses, nativeEnd = r.nativeAfter ?? (pending ? native : null);
      const elapsed = pending && Number.isFinite(monotonicNow) && Number.isFinite(r.startedMono) && monotonicNow >= r.startedMono ? number(monotonicNow - r.startedMono) : null;
      const hostFrames = delta(r.nativeBefore, nativeEnd, "hostFrames"), hostMs = delta(r.nativeBefore, nativeEnd, "hostMs");
      return { id: r.id, mode: r.mode, status: r.status,
        model: r.model ? { arch: r.model.arch ?? null, backend: r.model.backend ?? null } : null,
        ms: wall, elapsedSoFarMs: elapsed, preparationMs: number(r.preparedMs),
        submittedAfterMs: number(r.submittedAfterMs), displayPreparedMs: number(r.displayPreparedMs),
        modelTiming: { prepareMs: number(timing?.prepare), forwardMs: forward, totalMs: total, batched: timing?.batched ?? null },
        outsideModelMs: wall !== null && total !== null && wall >= total ? number(wall - total) : null,
        questions: r.requests?.reduce((n, item) => n + Object.keys(item.questions ?? {}).length, 0) ?? null,
        inputTokens: r.responses?.map(response => response.usage?.input_tokens ?? null) ?? null,
        observedTick: r.before?.tick ?? null, checkedTick: r.checkedAt?.tick ?? null,
        validation: age ? { phase: age.phase, valid: age.valid, reasons: [...age.reasons], ageTicks: age.ageTicks, ageMs: number(age.ageMs) } : null,
        nativeDuringInference: { pending, hostFrames, hostMs, meanHostMs: hostFrames > 0 && hostMs !== null ? number(hostMs / hostFrames) : null,
          loopMs: delta(r.nativeBefore, nativeEnd, "loopMs"), presents: delta(r.nativeBefore, nativeEnd, "presents"),
          deferred: delta(r.nativeBefore, nativeEnd, "deferred"),
          presentMs: delta(r.nativeBefore, nativeEnd, "presentMs") },
        error: r.error ? String(r.error).slice(0, 500) : null };
    }),
    notes: ["At 1×, 60 game ticks is about 1000 ms; the separate 1500 ms wall limit also applies.",
      "Warm-up uses a tiny request, not a gameplay decision. Model forward includes scheduling/waits, not just GPU execution. Display preparation overlaps the worker; do not add those durations.",
      "Native timings are CPU-side engine/presentation time; present calls do not measure actual compositor FPS. Host time includes non-deferred presentation; do not add those timings together.",
      "Lower Speed does not extend the wall deadline. Step freezes the world during inference instead of applying an old live answer."],
  };
}
