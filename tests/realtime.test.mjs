import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "../src/agent.js";
import { LIVE_TICKS, MAX_DECISION_AGE_MS, prepareDecision, situation } from "../src/decisions.js";
import { replies } from "./replies.mjs";
import { observation } from "./observations.mjs";

function fixture() {
  const state = observation();
  state.epoch = 1; state.tick = state.screen.tick = 10; state.player.health = 100; state.player.ammo = 25;
  const calls = [], actions = [];
  let pauses = 0, rejectAction = false;
  const engine = {
    snapshot: () => structuredClone(state),
    pause() { pauses++; state.paused = true; state.controlSession++; state.actionTicksLeft = 0; },
    startAuto() { state.paused = false; state.owned = true; return ++state.controlSession; },
    probe() { assert.fail("No geometry queries, including application-time probes"); },
    applyLive(p, session) {
      actions.push({ p, session });
      if (rejectAction) return false;
      state.actionSerial++; state.actionTicks = 0; state.actionTicksLeft = p.ticks; state.stopReason = null;
      return true;
    },
  };
  const model = { info: { backend: "test" }, decideMany(requests) { return new Promise((resolve, reject) => calls.push({ requests, resolve, reject })); } };
  const agent = new Agent({ engine, getModel: () => model });
  function advance(n) {
    assert.equal(state.paused, false);
    state.tick += n; state.screen.tick = state.tick; state.screen.frame++;
    state.actionTicks += Math.min(n, state.actionTicksLeft);
    state.actionTicksLeft = Math.max(0, state.actionTicksLeft - n);
    if (!state.actionTicksLeft) state.stopReason = "Action lease expired.";
  }
  function resolveScore(index = 0) {
    const call = calls.at(-1);
    const response = replies(call.requests, index);
    call.resolve(response);
    return response;
  }
  return { agent, engine, state, calls, actions, advance, resolveScore, get pauses() { return pauses; }, reject: () => { rejectAction = true; } };
}
async function decide(f) { const p = f.agent.score({ realtime: true }); f.resolveScore(); await p; return f.agent.applyLive(); }

test("real-time tactics disclose their bounded horizon and held action without probes", () => {
  const f = fixture(), result = prepareDecision(f.state, null, { realtime: true, heldAction: "Strafe left" });
  assert.ok(result.eligible.every(c => c.params.ticks === LIVE_TICKS));
  assert.match(result.requests[0].state, /Live, holding Strafe left/);
  assert.match(result.requests[0].state, /750ms/);
  assert.equal(result.eligible.find(c => c.id === "turn-left").params.yawRate, 90);
});

test("asynchronous scoring allows advancing ticks without pausing or fabricating a fresh timestamp", async () => {
  const f = fixture(); f.agent.startLive(); const pauses = f.pauses;
  const p = f.agent.score({ realtime: true }), record = f.agent.current;
  f.advance(24); const response = f.resolveScore();
  assert.equal(await p, record);
  assert.equal(f.pauses, pauses);
  assert.equal(f.state.paused, false);
  assert.strictEqual(record.responses, response);
  assert.equal(f.actions.length, 0, "scoring still does not apply a command by itself");
  assert.equal(f.agent.applyLive(), true);
  assert.equal(f.actions[0].p.tick, 10, "native code receives the actual observation tick, not the newer tick");
  assert.equal(record.appliedAt.tick, 34);
  assert.equal(record.ageTicksAtApply, 24);
  assert.equal(record.status, "acting");
  assert.equal(f.pauses, pauses);
});

test("only one decision is in flight; real-time responses cannot be debug-stepped", async () => {
  const f = fixture(); f.agent.startLive(); const p = f.agent.score({ realtime: true });
  await assert.rejects(f.agent.score({ realtime: true }), /Wait/);
  await assert.rejects(f.agent.step(), /Wait/);
  f.resolveScore(); await p;
  await assert.rejects(f.agent.step(), /paused observation/);
  await assert.rejects(f.agent.score(), /Pause Auto/);
});

for (const change of ["pause", "reset", "session", "epoch", "death", "completion", "human", "model", "old-ticks", "old-wall", "future-tick"]) {
  test(`${change} discards a pending real-time result without applying it`, async () => {
    const f = fixture(); f.agent.startLive(); const p = f.agent.score({ realtime: true });
    const record = f.agent.current;
    if (change === "pause") f.agent.pause();
    if (change === "reset") f.agent.invalidate();
    if (change === "session") f.state.controlSession++;
    if (change === "epoch") f.state.epoch++;
    if (change === "death") f.state.alive = false;
    if (change === "completion") f.state.completed = true;
    if (change === "human") f.state.owned = false;
    if (change === "model") f.agent.getModel = () => ({});
    if (change === "old-ticks") f.advance(61);
    if (change === "old-wall") record.startedMono -= MAX_DECISION_AGE_MS + 1;
    if (change === "future-tick") f.state.tick--;
    const response = f.resolveScore();
    assert.equal(await p, null);
    assert.equal(record.status, "discarded");
    assert.strictEqual(record.responses, response);
    assert.equal(f.actions.length, 0);
  });
}

test("same-level teleport resumes with a new session and discards the old pending reply", async () => {
  const f = fixture(); f.agent.startLive();
  const oldSession = f.agent.liveSession;
  const pending = f.agent.score({ realtime: true });
  f.state.epoch++; f.state.controlSession++; f.state.paused = true;
  f.state.stopReason = "Player teleported.";
  assert.equal(f.agent.observeLive(f.engine.snapshot()), true);
  assert.equal(f.state.paused, false);
  assert.notEqual(f.agent.liveSession, oldSession);
  f.resolveScore();
  assert.equal(await pending, null);
  assert.equal(f.actions.length, 0);
  assert.equal(f.agent.navigation, undefined);
  assert.equal(f.agent.observations.epoch, f.state.epoch);
  f.agent.pause(); f.state.stopReason = "Player teleported.";
  assert.equal(f.agent.observeLive(f.engine.snapshot()), false, "manual Pause must never auto-resume");
});

test("the last command continues during the next inference and is replaced without a pause", async () => {
  const f = fixture(); f.agent.startLive(); await decide(f);
  const first = f.agent.active, pauses = f.pauses;
  const p = f.agent.score({ realtime: true });
  f.advance(20);
  assert.equal(f.state.actionTicksLeft, 25);
  assert.equal(f.agent.active, first);
  f.resolveScore(); await p; f.agent.applyLive();
  assert.equal(first.status, "replaced");
  assert.equal(first.execution.ticksApplied, 20);
  assert.equal(f.state.actionTicksLeft, 45);
  assert.equal(f.pauses, pauses);
  assert.equal(f.agent.active.id, 2);
});

test("revalidation failure leaves the previous command alone rather than silently choosing another", async () => {
  const f = fixture(); f.agent.startLive(); await decide(f);
  const first = f.agent.active; f.reject();
  assert.equal(await decide(f), false);
  assert.equal(f.agent.current.status, "rejected");
  assert.equal(f.agent.active, first);
  assert.equal(f.state.actionSerial, 1);
  assert.equal(f.state.paused, false);
});

test("expired commands record active ticks separately from the later observation interval", async () => {
  const f = fixture(); f.agent.startLive(); await decide(f);
  const record = f.agent.active;
  f.advance(70); f.agent.observeLive(f.engine.snapshot());
  assert.equal(record.execution.ticksApplied, 45);
  assert.equal(record.after.tick - record.appliedAt.tick, 70);
  assert.equal(record.status, "executed");
  assert.equal(f.state.paused, false);
  assert.equal(f.agent.active, null);
  assert.equal(f.agent.observations.actions.at(-1).ticksApplied, 45);
  assert.match(situation(f.state, f.agent.observations.describe(f.state)), /Since forward:/);
});

test("pausing releases the active command and invalidates the pending replacement", async () => {
  const f = fixture(); f.agent.startLive(); await decide(f);
  const record = f.agent.active;
  const p = f.agent.score({ realtime: true });
  f.advance(10); f.agent.pause(); f.resolveScore();
  assert.equal(await p, null);
  assert.equal(f.state.paused, true);
  assert.equal(f.state.actionTicksLeft, 0);
  assert.equal(record.execution.ticksApplied, 10);
  assert.equal(record.status, "interrupted");
  assert.equal(f.agent.liveSession, null);
  assert.equal(f.actions.length, 1);
});

test("delayed forward choices remain relative inputs and never chase stale absolute camera angles", async () => {
  const f = fixture(); f.agent.startLive();
  for (let i = 0; i < 4; i++) {
    const pending = f.agent.score({ realtime: true }), r = f.agent.current;
    const index = r.eligible.findIndex(c => c.id === "forward");
    f.advance(9); f.resolveScore(index); await pending;
    assert.equal(f.agent.applyLive(), true);
    assert.strictEqual(f.actions.at(-1).p, r.selected.params);
    assert.equal(r.selected.params.forward, 1); assert.equal(r.selected.params.ref, 0);
    assert.equal(r.selected.params.yawRate, 0); assert.equal(r.selected.params.yaw, undefined);
    assert.equal(r.steering, undefined);
  }
});

for (const change of ["expired", "replaced", "pause-resume"]) {
  test(`${change} command does not claim it is still holding the earlier input`, async () => {
    const f = fixture(); f.state.enemies = []; f.agent.startLive();
    let pending = f.agent.score({ realtime: true });
    const index = f.agent.current.eligible.findIndex(c => c.id === "forward");
    f.resolveScore(index); await pending; f.agent.applyLive();
    if (change === "expired") f.advance(LIVE_TICKS);
    if (change === "replaced") f.state.actionSerial++;
    if (change === "pause-resume") { f.agent.pause(); f.agent.startLive(); }
    pending = f.agent.score({ realtime: true });
    assert.match(f.agent.current.sharedState, /Live, holding nothing/);
    f.resolveScore(); await pending;
    f.agent.pause();
  });
}

test("a scored real-time decision is rechecked once more just before native application", async () => {
  const f = fixture(); f.agent.startLive();
  const p = f.agent.score({ realtime: true }); f.resolveScore(); await p;
  f.advance(61);
  assert.equal(f.agent.applyLive(), false);
  assert.equal(f.agent.current.status, "discarded");
  assert.equal(f.actions.length, 0);
});
