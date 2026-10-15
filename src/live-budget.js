import { MAX_DECISION_AGE_MS, MAX_DECISION_AGE_TICKS } from "./decisions.js";

export const LIVE_MISS_LIMIT = 3;
const ageReasons = new Set(["tick-age", "wall-age"]);

/** Report every failed guard, without relaxing any deadline or substituting input. */
export function liveFreshness(now, before, { session, ageMs, generationChanged = false, modelChanged = false }) {
  const delta = now.tick - before.tick;
  const ageTicks = Number.isSafeInteger(delta) ? delta : null;
  const reasons = [];
  if (generationChanged) reasons.push("controller-changed");
  if (modelChanged) reasons.push("model-changed");
  if (!now.ready) reasons.push("not-ready");
  if (!now.alive) reasons.push("dead");
  if (now.completed) reasons.push("completed");
  if (now.paused) reasons.push("paused");
  if (!now.owned) reasons.push("not-owned");
  if (now.epoch !== before.epoch) reasons.push("world-changed");
  if (session === null || now.controlSession !== session || now.controlSession !== before.controlSession) reasons.push("session-changed");
  if (ageTicks === null || ageTicks < 0) reasons.push("invalid-tick");
  else if (ageTicks > MAX_DECISION_AGE_TICKS) reasons.push("tick-age");
  if (!Number.isFinite(ageMs) || ageMs < 0) reasons.push("invalid-clock");
  else if (ageMs > MAX_DECISION_AGE_MS) reasons.push("wall-age");
  return { valid: reasons.length === 0, reasons, ageTicks, ageMs: Number.isFinite(ageMs) ? ageMs : null,
    limits: { ticks: MAX_DECISION_AGE_TICKS, ms: MAX_DECISION_AGE_MS } };
}

export function freshnessMessage(check) {
  const details = check.reasons.map(reason => reason === "tick-age" ? `${check.ageTicks} game ticks old (limit ${check.limits.ticks})`
    : reason === "wall-age" ? `${Math.round(check.ageMs)} ms old (limit ${check.limits.ms} ms)` : reason.replaceAll("-", " "));
  return `Decision discarded: ${details.join("; ")}. No action applied.`;
}

/** Prevent an endless, resource-saturating retry loop. One cold/late result does not
 * stop play; only consecutive age-only failures in the same live run do. */
export class LiveBudget {
  constructor() { this.misses = 0; this.lastId = null; }
  observe(record) {
    if (!record || record.id === this.lastId) return null;
    this.lastId = record.id;
    const c = record.validation;
    const expired = record.mode === "realtime" && record.status === "discarded" && c?.valid === false &&
      c.reasons.length > 0 && c.reasons.every(reason => ageReasons.has(reason));
    this.misses = expired ? this.misses + 1 : 0;
    if (this.misses < LIVE_MISS_LIMIT) return null;
    const error = new Error(`Auto stopped: ${this.misses} consecutive decisions missed the live deadline. Last: ${Math.round(c.ageMs)} ms, ${c.ageTicks} game ticks; limits: ${c.limits.ms} ms and ${c.limits.ticks} ticks. Use Step to keep the world stopped during inference. Copy diagnostics for the timing breakdown.`);
    error.code = "live-budget-exhausted";
    return error;
  }
}
