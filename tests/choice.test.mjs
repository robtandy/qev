import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "../src/agent.js";
import { DEFAULT_DECISION_FORMAT, prepareDecision, requestsFor, rankResponses } from "../src/decisions.js";
import { observation } from "./observations.mjs";

const state = () => { const s = observation(); Object.assign(s.player, { health: 25, armor: 10, ammo: 12, silverKey: true }); s.pickups[0].kind = "gold_key"; return s; };
const eligible = [{ id: "a" }, { id: "b" }, { id: "c" }];
const response = (choice = "b", probabilities = { a: 0.4, b: 0.4, c: 0.2 }) => [{ answers: { action: { type: "choice", choice, probabilities } }, raw_probabilities: { action: [0.400001, 0.400002, 0.199997] }, untouched: "<script>not executable</script>" }];

test("choice is one state with a short description for every offered action", () => {
  assert.equal(DEFAULT_DECISION_FORMAT, "choice");
  const r = prepareDecision(state(), null, { realtime: true });
  assert.equal(r.decisionFormat, "choice");
  assert.equal(r.requests.length, 1);
  assert.ok(r.requests.every(request => request.state === r.sharedState));
  const input = r.requests[0];
  assert.equal(input.questions.action.type, "choice");
  assert.equal(input.state.match(/WIN/g).length, 1);
  assert.match(input.state, /health 25.*armor 10.*ammo 12.*keys silver/);
  assert.match(input.state, /gold key/);
  assert.match(input.state, /Not a safe-route test/);
  assert.doesNotMatch(input.state, /new cell|LOS clear|nearest observed threat/);
  assert.deepEqual(r.requests.map(request => Object.keys(request.questions)[0]), ["action"]);
  assert.deepEqual(Object.keys(input.questions.action.criteria), r.eligible.map(c => c.optionId));
  for (const c of r.eligible) {
    assert.equal(input.questions.action.criteria[c.optionId], c.choiceText);
    assert.ok(c.choiceText.length < 110);
    assert.equal(c.allowed, true);
  }
  input.questions.action.criteria[r.eligible[0].optionId] = "changed";
  assert.notEqual(r.eligible[0].choiceText, "changed", "request metadata must not alias mutable candidate descriptions");
});

test("the noul comparison uses the identical tactic and target pools and observation", () => {
  const s = state(), options = { realtime: true };
  const choice = prepareDecision(s, null, options);
  const noul = prepareDecision(s, null, { ...options, decisionFormat: "noul" });
  assert.deepEqual(choice.candidates, noul.candidates);
  assert.deepEqual(choice.eligible, noul.eligible);
  assert.equal(choice.sharedState, noul.sharedState);
  assert.equal(noul.requests.length, noul.eligible.length);
  assert.ok(noul.requests.slice(0, noul.eligible.length).every((r, i) => r.questions.favorable.type === "noul" && r.state === noul.eligible[i].state));
  assert.deepEqual(noul.automatic, choice.automatic);
  assert.deepEqual(requestsFor(choice.eligible, choice.sharedState, "noul"), noul.requests);
  assert.deepEqual(requestsFor(noul.eligible, noul.sharedState, "choice"), choice.requests);
});

test("inspection ranking retains the SDK argmax for rounded ties; execution samples separately", () => {
  const replies = response(), saved = structuredClone(replies);
  const ranking = rankResponses(replies, eligible);
  assert.deepEqual(ranking.map(r => r.index), [1, 0, 2]);
  assert.equal(ranking[0].id, replies[0].answers.action.choice);
  assert.equal(ranking[0].probability, 0.4);
  assert.deepEqual(replies, saved);
});

test("probabilities are mapped by action ID, not the response object's key order", () => {
  const ranked = rankResponses(response("b", { c: 0.1, b: 0.7, a: 0.2 }), eligible);
  assert.deepEqual(ranked.map(r => [r.index, r.probability]), [[1, 0.7], [0, 0.2], [2, 0.1]]);
});

test("legitimate SDK rounding and a single offered action remain valid", () => {
  assert.equal(rankResponses(response("c", { a: 0.33, b: 0.33, c: 0.33 }), eligible)[0].id, "c");
  assert.equal(rankResponses(response("a", { a: 1 }), [{ id: "a" }])[0].probability, 1);
});

for (const value of [undefined, null, "0.4", NaN, Infinity, -0.1, 1.1]) {
  test(`choice rejects invalid public probabilities (${String(value)})`, () => {
    assert.throws(() => rankResponses(response("b", { a: value, b: 0.4, c: 0.2 }), eligible), /Invalid/);
  });
}

for (const [label, replies] of [
  ["unknown action", response("not-offered")],
  ["non-string action", response(1)],
  ["missing probabilities", response("b", null)],
  ["missing action probability", response("b", { a: 0.3, b: 0.7 })],
  ["extra action probability", response("b", { a: 0.1, b: 0.7, c: 0.1, d: 0.1 })],
  ["wrong probability keys", response("b", { a: 0.1, b: 0.7, d: 0.2 })],
  ["non-normalized probabilities", response("b", { a: 0.8, b: 0.9, c: 0.7 })],
  ["choice contradicts probabilities", response("a", { a: 0.1, b: 0.8, c: 0.1 })],
  ["wrong question type", [{ answers: { action: { type: "noul", choice: "b", probabilities: { a: 0.1, b: 0.8, c: 0.1 } } } }]],
  ["unexpected response count", [...response(), ...response()]],
  ["noul cannot masquerade as a choice", [{ answers: { favorable: { noul: 0.9 } } }]],
]) {
  test(`choice rejects ${label} without a fallback action`, () => {
    assert.throws(() => rankResponses(replies, eligible), /Invalid|response count/);
  });
}

test("neutral option keys preserve the full menu without repeating internal tactic names in encoded keys", () => {
  const r = prepareDecision(state()), criteria = r.requests[0].questions.action.criteria;
  assert.deepEqual(Object.keys(criteria), r.eligible.map((_, i) => `a${i}`));
  assert.deepEqual(Object.values(criteria), r.eligible.map(c => c.choiceText));
  assert.ok(r.eligible.some(c => c.id === "fire")); assert.equal(criteria.fire, undefined);
  assert.equal(new Set(r.eligible.map(c => c.optionId)).size, r.eligible.length);
});

test("neutral keys map the untouched SDK answer and rounded tie to the actual tactic, not the first row", () => {
  const candidates = [{ id: "forward", optionId: "a0" }, { id: "attack", optionId: "a1" }, { id: "wait", optionId: "a2" }];
  const responses = response("a1", { a0: 0.4, a1: 0.4, a2: 0.2 }), saved = structuredClone(responses);
  const ranking = rankResponses(responses, candidates);
  assert.equal(ranking[0].id, "attack"); assert.equal(ranking[0].index, 1); assert.equal(ranking[0].probability, 0.4);
  assert.equal(candidates[ranking[0].index].optionId, responses[0].answers.action.choice);
  assert.deepEqual(responses, saved);
  assert.throws(() => rankResponses(response("attack", { a0: 0.1, a1: 0.8, a2: 0.1 }), candidates), /not one of the offered/);
  assert.throws(() => rankResponses(response("a1", { forward: 0.1, attack: 0.8, wait: 0.1 }), candidates), /keys must match/);
});

test("unknown formats fail and a controller's response protocol cannot change mid-flight", () => {
  assert.throws(() => prepareDecision(state(), null, { decisionFormat: "guess" }), /Unsupported/);
  assert.throws(() => new Agent({ engine: {}, getModel() {}, decisionFormat: "guess" }), /Unsupported/);
  const a = new Agent({ engine: {}, getModel() {}, decisionFormat: "noul" });
  assert.throws(() => { a.decisionFormat = "choice"; }, TypeError);
  assert.equal(a.decisionFormat, "noul");
});

test("a malformed choice is recorded unchanged but cannot score or execute", async () => {
  const before = state(), bad = response("not-offered"); let actions = 0;
  bad.push(...Array.from({ length: prepareDecision(before).requests.length - 1 }, () => ({ answers: {} })));
  const a = new Agent({ engine: { pause() {}, snapshot: () => structuredClone(before), act() { actions++; } },
    getModel: () => model });
  const model = { decideMany: async () => bad };
  await assert.rejects(a.score(), /not one of the offered actions/);
  assert.strictEqual(a.current.responses, bad);
  assert.equal(a.current.status, "error");
  assert.equal(a.current.selectedIndex, null);
  await assert.rejects(a.step(), /Score/);
  assert.equal(actions, 0);
});
