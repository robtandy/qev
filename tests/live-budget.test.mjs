import assert from "node:assert/strict";
import test from "node:test";
import { liveFreshness, freshnessMessage, LiveBudget, LIVE_MISS_LIMIT } from "../src/live-budget.js";
import { diagnosticSummary } from "../src/diagnostics.js";
import { Agent } from "../src/agent.js";
import { prepareDecision } from "../src/decisions.js";
import { observation, advance } from "./observations.mjs";
import { decisionReplies } from "./replies.mjs";

function check(ticks, ms, patch = {}, options = {}) {
  const before = observation(), now = structuredClone(before);
  now.paused = false; advance(now, ticks); Object.assign(now, patch);
  return liveFreshness(now, before, { session: before.controlSession, ageMs: ms, ...options });
}

test("both original freshness boundaries remain inclusive and independent", () => {
  assert.equal(check(60, 1500).valid, true);
  assert.deepEqual(check(61, 1100).reasons, ["tick-age"]);
  assert.deepEqual(check(20, 1500.1).reasons, ["wall-age"]);
  assert.deepEqual(check(80, 1900).reasons, ["tick-age", "wall-age"]);
  assert.deepEqual(check(-1, 100).reasons, ["invalid-tick"]);
  for (const age of [-1, NaN, Infinity]) assert.ok(check(1, age).reasons.includes("invalid-clock"));
  assert.match(freshnessMessage(check(80, 1900)), /80 game ticks old \(limit 60\).*1900 ms old \(limit 1500 ms\).*No action applied/);
});

for (const [reason, patch, options] of [
  ["controller-changed", {}, { generationChanged: true }], ["model-changed", {}, { modelChanged: true }],
  ["world-changed", { epoch: 99 }, {}], ["session-changed", { controlSession: 99 }, {}],
  ["not-owned", { owned: false }, {}], ["paused", { paused: true }, {}],
  ["dead", { alive: false }, {}], ["completed", { completed: true }, {}], ["not-ready", { ready: false }, {}],
]) test(`${reason} is distinguished from model deadline misses`, () => {
  const validation = check(80, 1900, patch, options);
  assert.ok(validation.reasons.includes(reason));
  const budget = new LiveBudget();
  for (let id = 1; id <= 5; id++) assert.equal(budget.observe({ id, mode: "realtime", status: "discarded", validation }), null);
  assert.equal(budget.misses, 0);
});

function late(id, extra = {}) {
  return { id, mode: "realtime", status: "discarded", validation: check(90, 2000), ...extra };
}
test("three distinct consecutive age-only misses trip the circuit; duplicate polls do not", () => {
  const budget = new LiveBudget(); assert.equal(LIVE_MISS_LIMIT, 3);
  assert.equal(budget.observe(late(1)), null);
  for (let i = 0; i < 50; i++) assert.equal(budget.observe(late(1)), null);
  assert.equal(budget.misses, 1); assert.equal(budget.observe(late(2)), null);
  const error = budget.observe(late(3));
  assert.equal(error.code, "live-budget-exhausted"); assert.match(error.message, /2000 ms, 90 game ticks/);
  assert.match(error.message, /Use Step/); assert.match(error.message, /Copy diagnostics/);
});

test("a fresh decision, unrelated cancellation, inspection, or new run breaks the miss streak", () => {
  for (const intervening of [late(2, { status: "scored" }), late(2, { status: "rejected" }), late(2, { mode: "inspection" }),
    late(2, { validation: check(90, 2000, {}, { generationChanged: true }) })]) {
    const budget = new LiveBudget(); budget.observe(late(1)); assert.equal(budget.observe(intervening), null);
    assert.equal(budget.misses, 0); assert.equal(budget.observe(late(3)), null);
  }
  assert.equal(new LiveBudget().observe(late(4)), null);
});

function fixture() {
  const state = observation(); let agent, finish, draws = 0;
  const native = { hostFrames: 0, hostMs: 0, presents: 0, deferred: 0, presentMs: 0, loopMs: 0 };
  const engine = { snapshot: () => structuredClone(state), diagnostics: () => ({ ...native }),
    pause() { state.paused = true; state.controlSession++; },
    startAuto() { state.paused = false; return ++state.controlSession; },
    applyLive() { assert.fail("Expired fixture must not apply input"); } };
  const model = { info: { arch: "laya", backend: "mock" }, decideMany: () => new Promise(resolve => { finish = resolve; }) };
  agent = new Agent({ engine, getModel: () => model, random: () => { draws++; return 0.2; } });
  return { state, native, engine, model, agent, finish: replies => finish(replies), get draws() { return draws; } };
}

test("delayed reply records tick and wall rejection independently, preserves raw data and consumes no sample", async () => {
  const f = fixture(); f.agent.startLive();
  const pending = f.agent.score({ realtime: true }), r = f.agent.current, originalRequests = structuredClone(r.requests);
  r.startedMono -= 2000; advance(f.state, 90); Object.assign(f.native, { hostFrames: 90, hostMs: 900, presents: 30, deferred: 90 });
  const replies = decisionReplies(r, { action: "forward" }); replies[0].timing = { prepare: 1, forward: 1700, total: 1702, batched: 1 };
  const raw = structuredClone(replies); f.finish(replies);
  assert.equal(await pending, null); assert.deepEqual(r.validation.reasons, ["tick-age", "wall-age"]);
  assert.equal(r.validation.phase, "reply"); assert.match(r.error, /game ticks old.*ms old/);
  assert.deepEqual(r.responses, raw); assert.deepEqual(r.requests, originalRequests); assert.equal(r.sampling, null); assert.equal(f.draws, 0);
  assert.equal(r.nativeBefore.hostFrames, 0); assert.equal(r.nativeAfter.hostFrames, 90);
  assert.doesNotMatch(JSON.stringify(r.requests), /hostFrames|nativeBefore|diagnostic|presentation|1700/);
});

test("the application guard has its own explicit timing evidence and never redraws a scored tactic", async () => {
  const f = fixture(); f.agent.startLive(); const pending = f.agent.score({ realtime: true });
  f.finish(decisionReplies(f.agent.current, { action: "forward" })); const r = await pending;
  const sample = structuredClone(r.sampling); r.startedMono -= 2000;
  assert.equal(f.agent.applyLive(), false); assert.equal(r.validation.phase, "application");
  assert.deepEqual(r.validation.reasons, ["wall-age"]); assert.deepEqual(r.sampling, sample); assert.equal(f.draws, 1);
  assert.equal(r.replyValidation.valid, true); assert.equal(r.replyValidation.phase, "reply");
});

test("timing observation failures cannot block inference or change submitted state/questions", async () => {
  const f = fixture(); f.engine.diagnostics = () => { throw new Error("unavailable performance counter"); };
  const expected = prepareDecision(f.state).requests, pending = f.agent.score();
  assert.deepEqual(f.agent.current.requests, expected);
  f.finish(decisionReplies(f.agent.current, { action: "forward" })); const r = await pending;
  assert.equal(r.status, "scored"); assert.equal(r.nativeBefore, null); assert.equal(r.nativeAfter, null);
});

test("worker dispatch precedes inspector rendering, with identical complete requests", async () => {
  const state = observation(), events = []; let agent;
  const engine = { snapshot: () => structuredClone(state), pause() {} };
  const model = { async decideMany(requests) {
    events.push("dispatch"); assert.strictEqual(requests, agent.current.requests);
    return decisionReplies(agent.current, { action: "forward" });
  } };
  agent = new Agent({ engine, getModel: () => model, onChange() { events.push(agent.current.status); } });
  const r = await agent.score(); assert.deepEqual(events, ["dispatch", "scoring", "scored"]);
  assert.deepEqual(r.requests, prepareDecision(state).requests);
  assert.ok(r.submittedAfterMs >= r.preparedMs); assert.ok(r.displayPreparedMs >= 0);
});

test("a display failure cannot release single-flight ownership before the actual worker reply settles", async () => {
  for (const fault of [new Error("display failed"), null]) {
    const f = fixture(); let first = true;
    f.agent.onChange = () => { if (first) { first = false; throw fault; } };
    const p = f.agent.score(), r = f.agent.current;
    assert.equal(f.agent.busy, true); await assert.rejects(f.agent.score(), /Wait/);
    const response = decisionReplies(r, { action: "forward" }); f.finish(response);
    await assert.rejects(p, error => error === fault); assert.equal(f.agent.busy, false);
    assert.strictEqual(r.responses, response); assert.equal(r.sampling, null); assert.equal(f.draws, 0);
  }
});

test("compact diagnostics distinguish warm-up from unknown inference time in a truncated record", () => {
  const d = diagnosticSummary({ model: { arch: "laya", backend: "webgpu", gpu: "synthetic", loadMs: 2600, warmupMs: 500 },
    observation: { epoch: 2, tick: 1387, actionSerial: 0 }, records: [{ id: 1, mode: "realtime", status: "discarded", before: { tick: 1 } }] });
  assert.equal(d.latest[0].ms, null); assert.equal(d.latest[0].modelTiming.forwardMs, null); assert.equal(d.latest[0].checkedTick, null);
  assert.equal(d.world.actionSerial, 0); assert.equal(d.model.warmupMs, 500); assert.equal(d.appliedLive, 0);
});

test("a still-pending reply reports elapsed time and current native deltas without inventing model timing", () => {
  const d = diagnosticSummary({ monotonicNow: 6000, native: { hostFrames: 40, hostMs: 140 }, records: [
    { id: 1, status: "scoring", startedMono: 1000, nativeBefore: { hostFrames: 10, hostMs: 20 } }] });
  const r = d.latest[0]; assert.equal(r.ms, null); assert.equal(r.elapsedSoFarMs, 5000);
  assert.equal(r.nativeDuringInference.pending, true); assert.equal(r.nativeDuringInference.hostFrames, 30);
  assert.equal(r.modelTiming.forwardMs, null); assert.equal(r.validation, null);
});

test("compact reports use at most five records, not repeated states/probabilities/SDK configs or summed batch timings", () => {
  const records = Array.from({ length: 50 }, (_, i) => ({ ...late(i + 1), ms: 1800, preparedMs: 2,
    model: { arch: "laya", backend: "webgpu", config: "SECRET".repeat(1000) },
    before: { tick: i }, checkedAt: { tick: i + 90 }, requests: [{ state: "SECRET".repeat(10_000), questions: { action: {} } }],
    responses: [{ timing: { prepare: 10, forward: 1700, total: 1720, batched: 2 }, usage: { input_tokens: 390 }, answers: { secret: "SECRET" } },
      { timing: { prepare: 10, forward: 1700, total: 1720, batched: 2 }, usage: { input_tokens: 390 } }], error: "expired".repeat(1000),
    nativeBefore: { hostFrames: 0, hostMs: 0 }, nativeAfter: { hostFrames: 90, hostMs: 900 } }));
  const raw = structuredClone(records), d = diagnosticSummary({ records, model: { arch: "kev-0.8b", backend: "wasm" } });
  assert.equal(d.model.arch, "kev-0.8b"); assert.deepEqual(d.latest[0].model, { arch: "laya", backend: "webgpu" });
  assert.equal(d.retainedRecords, 50); assert.equal(d.latest.length, 5); assert.equal(d.counts.discarded, 50);
  assert.equal(d.latest[0].modelTiming.totalMs, 1720); assert.equal(d.latest[0].outsideModelMs, 80);
  assert.equal(d.latest[0].nativeDuringInference.meanHostMs, 10);
  assert.equal(d.latest[0].questions, 1); assert.deepEqual(records, raw);
  assert.doesNotMatch(JSON.stringify(d), /SECRET|probabilities|candidates/);
  assert.ok(JSON.stringify(d).length < 9000, "summary must fit comfortably below the observed paste limit");
});
