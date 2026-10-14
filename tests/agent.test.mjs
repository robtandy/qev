import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "../src/agent.js";
import { replies, decisionReplies } from "./replies.mjs";
import { observation, advance, visible } from "./observations.mjs";

function fixture() {
  let state = observation(), pending;
  const calls = [], actions = [];
  const model = { info: { model: "test", backend: "mock" }, decideMany(requests) {
    calls.push(requests); return new Promise((resolve, reject) => { pending = { resolve, reject }; });
  } };
  const engine = { snapshot: () => structuredClone(state), pause: () => { state.paused = true; },
    probe() { assert.fail("Geometry must never be queried"); },
    act: async params => { actions.push(params); advance(state, params.ticks); state.actionTicks = params.ticks; state.player.health -= 2; return structuredClone(state); },
  };
  const agent = new Agent({ engine, getModel: () => model });
  return { agent, engine, model, calls, actions, get state() { return state; }, set state(s) { state = s; }, get pending() { return pending; } };
}
async function scored(f, selections = {}) {
  const p = f.agent.score(); f.pending.resolve(decisionReplies(f.agent.current, selections)); return p;
}

test("score freezes time and captures the actual complete request and untouched multi-head response", async () => {
  const f = fixture(), before = f.engine.snapshot(), promise = f.agent.score();
  assert.equal(f.agent.busy, true); assert.equal(f.calls.length, 1);
  assert.strictEqual(f.agent.current.requests, f.calls[0]);
  const response = replies(f.calls[0]); f.pending.resolve(response);
  const record = await promise;
  assert.strictEqual(record.responses, response);
  assert.equal(record.responses[0].raw_probabilities.action[0], 0.123456789);
  assert.deepEqual(record.requests.map(r => Object.keys(r.questions)[0]), ["action", "aim", "item", "weapon"]);
  assert.ok(record.requests.every(r => r.state === record.sharedState));
  assert.equal(record.status, "scored"); assert.equal(f.actions.length, 0);
  assert.deepEqual(f.engine.snapshot(), before); assert.equal(f.agent.busy, false);
});

test("only an explicit step executes the resolved composite selection and measures its outcome", async () => {
  const f = fixture(), record = await scored(f, { action: "attack" });
  await f.agent.step();
  assert.equal(f.actions.length, 1); assert.strictEqual(f.actions[0], record.selected.params);
  assert.equal(record.selected.params.ref, f.state.enemies[0].ref);
  assert.equal(record.after.tick - record.before.tick, 12); assert.equal(record.status, "executed");
  assert.equal(f.agent.memory.damage, 2); assert.equal(record.memoryAfter.actions.at(-1).damage, 2);
  await assert.rejects(f.agent.step(), /Score/);
});

test("the second model-selected target wins; code does not select first or nearest", async () => {
  const f = fixture(); f.state.enemies.push(visible("monster_ogre", 72));
  const record = await scored(f, { action: "left-fire", aim: "e2" });
  assert.equal(record.selected.params.ref, 72); assert.equal(record.selected.params.side, -1);
  assert.equal(record.selected.params.fire, true); assert.equal(record.selected.selection.id, "e2");
  assert.match(record.selected.label, /e2 ogre/); await f.agent.step();
  assert.equal(f.actions[0].ref, 72);
});

for (const [action, key] of [["attack", "aim"], ["approach", "item"], ["forward", "weapon"], ["attack", "weapon"], ["wait", "weapon"]]) {
  test(`a missing or fabricated ${key} rejects ${action}, preserving the raw response without fallback`, async () => {
    for (const invalid of [undefined, { type: "choice", choice: "invented", probabilities: { invented: 1 } }]) {
      const f = fixture(), p = f.agent.score(), response = decisionReplies(f.agent.current, { action });
      response[f.calls[0].findIndex(r => r.questions[key])].answers[key] = invalid; f.pending.resolve(response);
      await assert.rejects(p, new RegExp(`Invalid ${key} selection`));
      assert.strictEqual(f.agent.current.responses, response); assert.equal(f.agent.current.status, "error");
      await assert.rejects(f.agent.step(), /Score/); assert.equal(f.actions.length, 0);
    }
  });
}

test("the selected tactic ignores unrelated target answers, rather than silently turning into an attack", async () => {
  const f = fixture(), p = f.agent.score(), response = decisionReplies(f.agent.current, { action: "jump" });
  delete response[1].answers.aim; f.pending.resolve(response);
  const r = await p; assert.equal(r.selected.params.ref, 0); assert.equal(r.selected.params.jump, true);
  assert.equal(r.selected.params.fire, false); await f.agent.step(); assert.equal(f.actions[0].jump, true);
});

test("only one score/step is in flight; repeated clicks cannot queue execution", async () => {
  const f = fixture(), p = f.agent.score();
  await assert.rejects(f.agent.score(), /Wait/); await assert.rejects(f.agent.step(), /Wait/);
  f.pending.resolve(replies(f.calls[0])); await p;
  let finish; f.engine.act = () => new Promise(r => { finish = r; });
  const stepping = f.agent.step(); await assert.rejects(f.agent.step(), /Wait/);
  finish({ ...f.engine.snapshot(), tick: 54 }); await stepping;
});

for (const change of ["reset", "tick", "model", "death", "completion"]) {
  test(`${change} discards a late response without executing`, async () => {
    const f = fixture(), p = f.agent.score(), record = f.agent.current;
    if (change === "reset") { f.agent.invalidate(); f.state.epoch++; }
    if (change === "tick") f.state.tick++;
    if (change === "model") f.agent.getModel = () => ({});
    if (change === "death") f.state.alive = false;
    if (change === "completion") f.state.completed = true;
    f.pending.resolve(replies(f.calls[0])); assert.equal(await p, null);
    assert.equal(record.status, "discarded"); assert.equal(f.actions.length, 0); assert.equal(f.agent.busy, false);
  });
}

test("pausing while scoring permits inspection but never executes the answer", async () => {
  const f = fixture(), p = f.agent.score(); f.agent.pause(); f.pending.resolve(replies(f.calls[0]));
  assert.equal((await p).status, "scored"); assert.equal(f.actions.length, 0);
});

test("changed snapshots and models cannot execute an otherwise valid old choice", async () => {
  for (const change of [f => f.state.tick++, f => { f.agent.getModel = () => ({}); }]) {
    const f = fixture(); await scored(f); change(f);
    await assert.rejects(f.agent.step(), /world changed/); assert.equal(f.actions.length, 0);
  }
});

test("errors after invalidation are discarded; active errors retain their cause", async () => {
  const f = fixture(); let p = f.agent.score();
  f.agent.invalidate(); f.pending.reject(new Error("old model failed"));
  assert.equal(await p, null); assert.equal(f.agent.current, null);
  p = f.agent.score(); f.pending.reject(new Error("active failure"));
  await assert.rejects(p, /active failure/); assert.equal(f.agent.current.status, "error");
  assert.equal(f.agent.current.error, "active failure"); assert.equal(f.agent.busy, false);
});

test("malformed responses remain inspectable but cannot become a choice", async () => {
  const f = fixture(), p = f.agent.score(), bad = [{ unexpected: "raw payload" }]; f.pending.resolve(bad);
  await assert.rejects(p, /response count|Invalid action choice/); assert.strictEqual(f.agent.current.responses, bad);
  assert.equal(f.agent.current.selectedIndex, null); await assert.rejects(f.agent.step(), /Score/);
});

test("input-limit warnings fail closed rather than applying a possibly truncated decision", async () => {
  const f = fixture(); f.model.info.arch = "laya";
  const p = f.agent.score(), response = replies(f.calls[0]); response[0].usage = { input_tokens: 512 }; f.pending.resolve(response);
  await assert.rejects(p, /input limit/); assert.strictEqual(f.agent.current.responses, response);
  assert.equal(f.agent.current.warnings.length, 1); assert.equal(f.actions.length, 0);
});

test("interrupted and zero-input actions retain actual ticks, not requested duration or fictitious experience", async () => {
  for (const ticks of [0, 3]) {
    const f = fixture(), r = await scored(f);
    f.engine.act = async () => ({ ...f.engine.snapshot(), tick: f.state.tick + ticks, actionTicks: ticks });
    await f.agent.step(); assert.equal(r.status, "interrupted"); assert.equal(r.execution.ticksApplied, ticks);
    assert.equal(f.agent.observations.actions.length, ticks ? 1 : 0);
  }
});

test("similar-view history is measured, persists across Stop, and clears on a new episode", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) { await scored(f, { action: "wait" }); await f.agent.step(); }
  assert.equal(f.agent.observations.repeated, 2);
  const old = structuredClone(f.agent.observations.actions); f.agent.invalidate();
  assert.deepEqual(f.agent.observations.actions, old);
  f.state.epoch++; f.agent.observeObservation(f.state); assert.equal(f.agent.observations.actions.length, 0);
  assert.equal(f.agent.memory, null);
});

test("history is bounded and retains paired requests/responses including target choices", async () => {
  const f = fixture(); for (let i = 0; i < 55; i++) await scored(f);
  assert.equal(f.agent.history.length, 50); assert.equal(f.agent.history[0].id, 6); assert.equal(f.agent.history.at(-1).id, 55);
  assert.ok(f.agent.history.every(r => r.requests[1].questions.aim && r.responses[1].answers.aim));
});
