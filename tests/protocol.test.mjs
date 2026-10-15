import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Agent } from "../src/agent.js";
import { prepareDecision, rankDecision, resolveSelection } from "../src/decisions.js";
import { modelState, decisionView } from "../src/decision-cards.js";
import { ObservationMemory, perception, sceneText } from "../src/perception.js";
import { observation, advance } from "./observations.mjs";
import { replies, decisionReplies } from "./replies.mjs";

for (const [label, mutate] of [
  ["unready", s => { s.ready = false; delete s.player; }],
  ["dead", s => s.alive = false], ["complete", s => s.completed = true],
]) test(`${label} observations cannot create requests or bind targets for execution`, () => {
  const s = observation(); mutate(s); const r = prepareDecision(s);
  assert.deepEqual(r.eligible, []); assert.deepEqual(r.requests, []);
});

test("one batch preserves shared state verbatim while accounting for each question independently", () => {
  const r = prepareDecision(observation());
  assert.equal(r.requests.length, 1); assert.equal(modelState(r), r.sharedState);
  assert.ok(r.requests.every(request => Object.keys(request.questions).length === 1));
  r.responses = decisionReplies(r, { action: "attack" });
  r.selectedIndex = rankDecision(r)[0].index; r.selected = resolveSelection(r);
  assert.equal(r.selected.selection.responseIndex, undefined);
  assert.equal(r.selected.selection.answer, undefined);
  assert.equal(r.selected.selection.method, "nearest-visible-distance-v1");
  r.status = "scored"; r.before = observation(); r.ms = 10;
  assert.match(decisionView(r).action, /Hold position and attack nearest enemy · nearest grunt/);
});

test("single-question Laya usage is retained without invented binding sequences", async () => {
  const s = observation(); const engine = { pause() {}, snapshot: () => structuredClone(s) };
  const model = { info: { arch: "laya" }, async decideMany(requests) {
    return replies(requests).map(r => ({ ...r, usage: { input_tokens: 300 } }));
  } };
  const agent = new Agent({ engine, getModel: () => model }), r = await agent.score();
  assert.equal(r.responses.reduce((sum, response) => sum + response.usage.input_tokens, 0), 300);
  assert.equal(r.status, "scored"); assert.deepEqual(r.warnings, []);
});

test("a saturated action question rejects the decision without sampling or automatic execution", async () => {
  const s = observation(); const engine = { pause() {}, snapshot: () => structuredClone(s) };
  const model = { info: { arch: "laya" }, async decideMany(requests) {
    return replies(requests).map((r, i) => ({ ...r, usage: { input_tokens: i === 0 ? 512 : 300 } }));
  } };
  const agent = new Agent({ engine, getModel: () => model });
  await assert.rejects(agent.score(), /512-token input limit/);
  assert.equal(agent.current.status, "error"); assert.equal(agent.current.selectedIndex, null);
  assert.equal(agent.current.responses[0].usage.input_tokens, 512);
});

test("missing or extra response items cannot shift which answer is bound to the chosen tactic", () => {
  const r = prepareDecision(observation()), correct = decisionReplies(r, { action: "attack" });
  for (const responses of [correct.slice(1), [...correct, correct[0]]]) {
    r.responses = responses; assert.throws(() => rankDecision(r), /response count/);
  }
  r.responses = structuredClone(correct);
  r.responses[0].answers = { aim: { type: "choice", choice: "e1", probabilities: { e1: 1 } } };
  assert.throws(() => resolveSelection(r), /Invalid action choice/);
});

test("held-weapon choice accompanies movement; switching HUD counters is not ammo expenditure", () => {
  const s = observation(), memory = new ObservationMemory(); memory.observe(s);
  const r = prepareDecision(s);
  r.responses = decisionReplies(r, { action: "forward", weapon: "w2" });
  r.selectedIndex = rankDecision(r)[0].index; const selection = resolveSelection(r);
  assert.match(selection.label, /Run forward · auto shotgun/); assert.equal(selection.params.weapon, 2);
  assert.equal(selection.params.forward, 1); assert.equal(selection.weaponSelection.id, "w2");
  const after = structuredClone(s); advance(after, 12); after.player.weapon = "axe"; after.player.ammo = 0;
  memory.outcome({ id: "forward", label: "Walk forward · axe" }, s, after, 12);
  assert.equal(memory.actions[0].weaponChanged, true); assert.equal(memory.actions[0].ammoChange, null);
  assert.match(prepareDecision(after, memory.describe(after)).sharedState, /weapon changed/);
});

test("occluding objects don't turn a few floor pixels into a floor region; tiny visible hazards are retained", () => {
  const s = observation(); s.scene[6] = [10, 0, 0, 0, 0, 0, 0, 0];
  assert.match(sceneText(perception(s)), /L unclassified/);
  s.scene[6] = [15000, 14000, 0, 0, 0, 0, 1, 0];
  assert.match(sceneText(perception(s)), /L floor-like\/wall-like\/lava/);
});

test("server interaction metadata cannot reveal a plain-looking door or button", () => {
  const bridge = readFileSync(new URL("../engine/qev_bridge.c", import.meta.url), "utf8");
  const classify = bridge.slice(bridge.indexOf("static const char *entity_kind"), bridge.indexOf("static int view_available"));
  assert.doesNotMatch(classify, /func_door|func_button|required_key|locked|deadflag|->v.health|->v.enemy/);
  assert.match(classify, /plain-looking wall/);
});

test("the checked-in example is marked synthetic and uses the current explicit batch/command contract", () => {
  const example = JSON.parse(readFileSync(new URL("../examples/combat-decision.json", import.meta.url), "utf8"));
  assert.equal(example.synthetic, true); assert.match(example.notice, /Not captured gameplay/);
  assert.equal(example.controlMode, "visible-assisted");
  assert.ok(example.requests.every(r => Object.keys(r.questions).length === 1));
  assert.equal(new Set(example.requests.map(r => r.state)).size, 1);
  assert.ok(example.responses.every(r => r.model === "synthetic-example-no-inference"));
  assert.equal(example.resolvedCommandExample.params.ref, example.observation.enemies[0].ref);
  assert.equal(example.resolvedCommandExample.id, "engage"); assert.equal(example.resolvedCommandExample.params.meleeApproach, true);
  assert.equal(example.resolvedCommandExample.params.side, 0); assert.equal(example.resolvedCommandExample.params.forward, 0);
  assert.equal(example.resolvedCommandExample.optionId, example.sampling.heads.action.optionId);
  assert.notEqual(example.resolvedCommandExample.optionId, example.responses[0].answers.action.choice);
  assert.equal(example.sampling.heads.action.sdkChoice, example.responses[0].answers.action.choice);
  assert.equal(example.resolvedCommandExample.weaponSelection.id, "w2"); assert.equal(example.resolvedCommandExample.params.weapon, 2);
  assert.doesNotMatch(JSON.stringify(example.observation), /position|distance|bearingRight|lineOfSight/);
});
