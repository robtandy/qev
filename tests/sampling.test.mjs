import assert from "node:assert/strict";
import test from "node:test";
import { sampleDistribution, SAMPLING_METHOD } from "../src/sampling.js";
import { prepareDecision, resolveSelection, rankDecision } from "../src/decisions.js";
import { Agent } from "../src/agent.js";
import { decisionOutcome, decisionView } from "../src/decision-cards.js";
import { decisionReplies } from "./replies.mjs";
import { observation, visible } from "./observations.mjs";

const draws = values => {
  let calls = 0;
  return { random: () => { assert.ok(calls < values.length, "unexpected extra draw"); return values[calls++]; }, get calls() { return calls; } };
};
function record(selections = { action: "engage" }) {
  const s = observation(); s.enemies.push(visible("monster_ogre", 72));
  const r = { before: s, ...prepareDecision(s), selectedIndex: null, sampling: null };
  r.responses = decisionReplies(r, selections); return r;
}
function head(r, question, probabilities, sdkChoice) {
  const response = r.responses.find(response => Object.hasOwn(response.answers, question));
  const key = id => question === "action" ? r.eligible.find(c => c.id === id).optionId : id;
  const entries = question === "action" ? r.eligible.map(c => c.optionId) : r.bindings[question].map(c => c.id);
  response.answers[question] = { type: "choice", choice: key(sdkChoice), probabilities: {
    ...Object.fromEntries(entries.map(id => [id, 0])), ...Object.fromEntries(Object.entries(probabilities).map(([id, p]) => [key(id), p])) } };
}

test("inverse CDF uses offer order, half-open boundaries and never selects a zero-weight option", () => {
  const weights = Object.freeze([0, 0.25, 0, 0.5, 0.25, 0]);
  for (const [draw, expected] of [[0, 1], [0.25 - Number.EPSILON, 1], [0.25, 3], [0.75, 4], [1 - Number.EPSILON, 4]]) {
    const sampled = sampleDistribution(weights, () => draw);
    assert.equal(sampled.index, expected);
    assert.ok(draw >= sampled.interval[0] && draw < sampled.interval[1]);
    assert.equal(sampled.probability, weights[expected]); assert.equal(sampled.totalProbability, 1);
  }
});

test("rounded public probabilities are normalized only for sampling, not rewritten or tempered", () => {
  const weights = Object.freeze([0.33, 0.33, 0.33]), sampled = sampleDistribution(weights, () => 0.7);
  assert.equal(sampled.index, 2); assert.equal(sampled.totalProbability, 0.99); assert.equal(sampled.probability, 0.33);
  assert.equal(sampled.normalizedProbability, 0.33 / 0.99); assert.equal(sampled.interval[1], 1);
  assert.deepEqual(weights, [0.33, 0.33, 0.33]);
});

test("uniform quantile coverage reproduces the full distribution without top-k or argmax bias", () => {
  const counts = [0, 0, 0];
  for (let i = 0; i < 10_000; i++) counts[sampleDistribution([0.2, 0.3, 0.5], () => (i + 0.5) / 10_000).index]++;
  assert.deepEqual(counts, [2000, 3000, 5000]);
  assert.equal(sampleDistribution([0.999999, 0.000001], () => 0.9999995).index, 1, "small tails are not dropped");
});

for (const value of [-1, 1, 1.1, NaN, Infinity, null, undefined, "0.5"]) {
  test(`invalid random draw ${String(value)} rejects without clamping or fallback`, () => {
    assert.throws(() => sampleDistribution([0.2, 0.8], () => value), /Invalid sampling draw/);
  });
}

test("invalid or zero-total weights reject before consuming randomness", () => {
  for (const weights of [[], [0, 0], [-0.1, 1], [NaN], [Infinity], [null], ["1"], [1.1], null])
    assert.throws(() => sampleDistribution(weights, () => assert.fail("must not draw")), /Invalid sampling/);
});

test("tactic, target and equipment can ALL differ from SDK argmax, with exact immutable evidence and replayable draws", () => {
  const r = record();
  head(r, "action", { wait: 0.55, engage: 0.45 }, "wait");
  head(r, "aim", { e1: 0.7, e2: 0.3 }, "e1");
  head(r, "weapon", { w1: 0.15, w2: 0.85 }, "w2");
  const raw = structuredClone(r.responses), requests = structuredClone(r.requests), random = draws([0.2, 0.8, 0.1]);
  for (const response of r.responses) for (const answer of Object.values(response.answers)) { Object.freeze(answer.probabilities); Object.freeze(answer); }
  r.selected = resolveSelection(r, random);
  assert.equal(r.selected.id, "engage"); assert.equal(r.selected.params.ref, 72); assert.equal(r.selected.params.weapon, 1);
  assert.equal(r.selected.params.meleeApproach, true); assert.equal(r.selected.selection.id, "e2");
  assert.equal(r.selected.selection.answer.choice, "e1"); assert.equal(r.selected.weaponSelection.id, "w1");
  assert.equal(r.selected.weaponSelection.answer.choice, "w2");
  assert.equal(rankDecision(r)[0].id, "wait", "inspection ranking still preserves SDK argmax");
  assert.deepEqual(r.responses, raw); assert.deepEqual(r.requests, requests); assert.equal(random.calls, 3);
  assert.equal(r.sampling.method, SAMPLING_METHOD); assert.equal(r.sampling.complete, true);
  assert.deepEqual(Object.keys(r.sampling.heads), ["action", "aim", "weapon"]);
  for (const [question, sampled] of Object.entries(r.sampling.heads)) {
    const answer = r.responses[sampled.responseIndex].answers[question];
    const replay = sampleDistribution(sampled.options.map(id => answer.probabilities[id]), () => sampled.draw);
    assert.equal(sampled.optionId, sampled.options[replay.index]); assert.equal(sampled.index, replay.index);
    assert.deepEqual(sampled.interval, replay.interval); assert.equal(sampled.sdkChoice, answer.choice);
    assert.equal(sampled.normalizedProbability, replay.normalizedProbability);
  }
  assert.throws(() => resolveSelection(r, random), /already been sampled/); assert.equal(random.calls, 3);
  assert.strictEqual(decisionOutcome(r).sampling, r.sampling);
  assert.match(decisionView({ ...r, status: "scored", ms: 10 }).meta, /sampled/);
});

test("rounded ties may sample either option; SDK tie-breaking survives unchanged in ranking and the response", () => {
  for (const [draw, expected] of [[0, "forward"], [0.6, "back"]]) {
    const r = record({ action: "back" }); head(r, "action", { forward: 0.5, back: 0.5 }, "back");
    const raw = structuredClone(r.responses), random = draws([draw, 0]);
    assert.equal(resolveSelection(r, random).id, expected); assert.equal(r.ranking[0].id, "back");
    assert.deepEqual(r.responses, raw);
  }
});

test("sampling consumes only the chosen tactic's relevant heads; unused malformed answers cannot invent targets", () => {
  const r = record({ action: "forward" }); delete r.responses[1].answers.aim; delete r.responses[2].answers.item;
  const random = draws([0.9, 0.1]), selected = resolveSelection(r, random);
  assert.equal(selected.id, "forward"); assert.equal(selected.params.ref, 0); assert.equal(selected.selection, null);
  assert.deepEqual(Object.keys(r.sampling.heads), ["action", "weapon"]); assert.equal(random.calls, 2);
});

test("a sampled pickup binds the sampled item rather than the SDK top item", () => {
  const s = observation(); s.pickups.push(visible("item_health", 90));
  const r = prepareDecision(s); r.responses = decisionReplies(r, { action: "approach" });
  const [first, second] = r.bindings.item;
  head(r, "item", { [first.id]: 0.8, [second.id]: 0.2 }, first.id);
  const random = draws([0.2, 0.9, 0.3]), selected = resolveSelection(r, random);
  assert.equal(selected.params.ref, 90); assert.equal(selected.selection.id, second.id);
  assert.deepEqual(Object.keys(r.sampling.heads), ["action", "item", "weapon"]);
});

test("one owned weapon requires no equipment distribution or invented draw", () => {
  const s = observation(); s.player.weapons = [{ id: 1, name: "axe" }]; s.player.weapon = "axe";
  const r = prepareDecision(s); r.responses = decisionReplies(r, { action: "engage" });
  const random = draws([0.25, 0.75]), selected = resolveSelection(r, random);
  assert.equal(selected.params.weapon, 0); assert.equal(selected.weaponSelection, null);
  assert.deepEqual(Object.keys(r.sampling.heads), ["action", "aim"]); assert.equal(random.calls, 2);
});

test("a malformed used head rejects the sampled action with no additional draws or retry", () => {
  const r = record(); delete r.responses.find(r => r.answers.weapon).answers.weapon;
  const raw = structuredClone(r.responses), random = draws([0.5]);
  assert.throws(() => resolveSelection(r, random), /Invalid weapon selection/);
  assert.equal(r.sampling.complete, false); assert.deepEqual(Object.keys(r.sampling.heads), ["action"]);
  assert.throws(() => resolveSelection(r, random), /already been sampled/); assert.equal(random.calls, 1);
  assert.deepEqual(r.responses, raw);
});

test("contradictory SDK argmax and malformed action distributions still reject before drawing", () => {
  const r = record(); head(r, "action", { wait: 0.8, engage: 0.2 }, "engage");
  assert.throws(() => resolveSelection(r, { random: () => assert.fail("must not draw") }), /contradicts/);
  assert.equal(r.sampling, null); assert.equal(r.selectedIndex, null);
});

test("noul diagnostic scores are not silently treated as a categorical distribution", () => {
  const r = prepareDecision(observation(), null, { decisionFormat: "noul" });
  r.responses = decisionReplies(r, { action: "forward" });
  const random = draws([0.1]), selected = resolveSelection(r, random);
  assert.equal(selected.id, "forward"); assert.equal(r.sampling.heads.action.method, "highest-noul-rating");
  assert.equal(r.sampling.heads.action.draw, undefined); assert.equal(r.sampling.heads.weapon.method, SAMPLING_METHOD);
  assert.equal(random.calls, 1);
});

function agentFixture({ realtime = false } = {}) {
  const state = observation(), actions = [], random = draws([0.1, 0.7]); let finish;
  const model = { info: {}, decideMany: () => new Promise(resolve => { finish = resolve; }) };
  const engine = { snapshot: () => structuredClone(state), pause: () => { state.paused = true; },
    startAuto: () => { state.paused = false; state.owned = true; state.controlSession++; return state.controlSession; },
    act: async p => { actions.push(p); state.tick += p.ticks; state.screen.tick = state.tick; state.actionTicks = p.ticks; return structuredClone(state); },
    applyLive: p => { actions.push(p); return false; } };
  const agent = new Agent({ engine, getModel: () => model, random: random.random });
  if (realtime) agent.startLive();
  const promise = agent.score({ realtime }), r = agent.current;
  r.responses = decisionReplies(r, { action: "wait" });
  head(r, "action", { forward: 0.25, wait: 0.75 }, "wait");
  return { state, agent, model, actions, random, r, promise, finish: () => finish(r.responses) };
}

test("Agent scores once, then Step executes that same sampled composite without redrawing", async () => {
  const f = agentFixture(); f.finish(); const r = await f.promise;
  assert.equal(r.selected.id, "forward"); assert.equal(r.responses[0].answers.action.choice, r.eligible.find(c => c.id === "wait").optionId);
  assert.equal(f.random.calls, 2); await f.agent.step();
  assert.strictEqual(f.actions[0], r.selected.params); assert.equal(f.random.calls, 2);
  await assert.rejects(f.agent.step(), /Score/); assert.equal(f.actions.length, 1);
});

test("stale scoring and token-limit failures consume no sampling randomness", async () => {
  const stale = agentFixture(); stale.state.tick++; stale.finish();
  assert.equal(await stale.promise, null); assert.equal(stale.random.calls, 0); assert.equal(stale.r.sampling, null);
  const capped = agentFixture(); capped.model.info.arch = "laya"; capped.r.responses[1].usage = { input_tokens: 512 }; capped.finish();
  await assert.rejects(capped.promise, /512-token input limit/); assert.equal(capped.random.calls, 0); assert.equal(capped.r.sampling, null);
});

test("a stale Step and a rejected live application never fall back or resample", async () => {
  const stale = agentFixture(); stale.finish(); await stale.promise; stale.state.tick++;
  await assert.rejects(stale.agent.step(), /world changed/); assert.equal(stale.random.calls, 2); assert.equal(stale.actions.length, 0);
  const live = agentFixture({ realtime: true }); live.finish(); const r = await live.promise;
  assert.equal(live.agent.applyLive(), false); assert.equal(r.status, "rejected"); assert.equal(live.random.calls, 2);
  assert.strictEqual(live.actions[0], r.selected.params); assert.equal(r.selected.id, "forward");
  assert.throws(() => live.agent.applyLive(), /Score/); assert.equal(live.random.calls, 2);
});
