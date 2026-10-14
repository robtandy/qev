import assert from "node:assert/strict";
import test from "node:test";
import { prepareDecision, rankDecision, resolveSelection } from "../src/decisions.js";
import { ObservationMemory } from "../src/perception.js";
import { observation, advance } from "./observations.mjs";
import { replies, decisionReplies } from "./replies.mjs";

function resolve(s, action, weapon, format = "choice") {
  const record = prepareDecision(s, null, { decisionFormat: format });
  record.responses = decisionReplies(record, { action, weapon });
  const raw = structuredClone(record.responses);
  record.selectedIndex = rankDecision(record)[0].index;
  const choice = resolveSelection(record);
  assert.deepEqual(record.responses, raw, "equipment binding must preserve the original model outputs");
  return { record, choice };
}

for (const format of ["choice", "noul"]) test(`${format}: keeping the shotgun never replaces any chosen tactic with a weapon-only no-op`, () => {
  const s = observation(), menu = prepareDecision(s).eligible;
  assert.ok(menu.every(c => c.id !== "weapon"));
  for (const candidate of menu) {
    const { record, choice } = resolve(s, candidate.id, "w2", format);
    assert.equal(choice.id, candidate.id);
    for (const field of ["forward", "side", "up", "yawRate", "pitchRate", "fire", "jump", "ticks", "meleeApproach"])
      assert.equal(choice.params[field], candidate.params[field], `${candidate.id}: ${field} must not be displaced by equipment`);
    assert.equal(choice.params.weapon, 2);
    assert.equal(choice.weaponSelection.id, "w2"); assert.equal(choice.weaponSelection.name, "shotgun");
    assert.deepEqual(choice.weaponSelection.answer, record.responses[choice.weaponSelection.responseIndex].answers.weapon);
    assert.equal(choice.selection?.question ?? null, candidate.binding);
    assert.match(choice.label, / · shotgun$/);
    assert.equal(record.grounding.weapon.criteria.w2, "shotgun; ranged pellets; spread at distance; 8 shells (held)");
  }
});

test("a stationary weapon switch is still an explicit wait plus equipment choice, not a substituted tactic", () => {
  const { choice } = resolve(observation(), "wait", "w1");
  assert.equal(choice.id, "wait"); assert.equal(choice.params.weapon, 1);
  assert.equal(choice.params.forward, 0); assert.equal(choice.params.fire, false);
  assert.equal(choice.label, "Wait · axe");
});

test("desired weapon is preserved even if it was already equipped in the scored observation", () => {
  const s = observation(), { choice } = resolve(s, "forward-fire", "w2");
  // The executor, not the old observation, must decide whether a switch press is needed.
  s.player.weapon = "axe";
  assert.equal(choice.params.weapon, 2); assert.equal(choice.params.forward, 1); assert.equal(choice.params.fire, true);
});

test("one owned weapon creates no artificial equipment question or implicit switch", () => {
  const s = observation(); s.player.weapons = [{ id: 2, name: "shotgun" }];
  const { record, choice } = resolve(s, "forward", undefined);
  assert.equal(record.grounding.weapon, undefined); assert.deepEqual(record.bindings.weapon, []);
  assert.equal(choice.params.weapon, 0); assert.equal(choice.weaponSelection, null); assert.equal(choice.params.forward, 1);
});

test("a legacy standalone weapon answer is rejected rather than mapped to movement or a fallback", () => {
  const r = prepareDecision(observation()); r.responses = replies(r.requests, null, { action: "weapon", weapon: "w2" });
  assert.throws(() => rankDecision(r), /not one of the offered actions/);
});

test("unknown or malformed equipment rejects a valid movement answer without defaulting to the held weapon", () => {
  for (const answer of [undefined, { type: "choice", choice: "w9", probabilities: { w9: 1 } },
    { type: "choice", choice: "w1", probabilities: { w1: 0.1, w2: 0.9 } }]) {
    const r = prepareDecision(observation()); r.responses = decisionReplies(r, { action: "forward" });
    r.selectedIndex = rankDecision(r)[0].index;
    r.responses.find(response => response.answers.weapon).answers.weapon = answer;
    assert.throws(() => resolveSelection(r), /Invalid weapon selection/);
  }
});

test("observed equipment mismatch is reported as an outcome, never hidden or replaced by an ammo heuristic", () => {
  const s = observation(); s.player.weapons.push({ id: 8, name: "lightning" }); s.player.cells = 0;
  const { choice } = resolve(s, "forward-fire", "w8"), memory = new ObservationMemory(); memory.observe(s);
  assert.equal(choice.params.weapon, 8); assert.equal(choice.params.fire, true); assert.equal(choice.params.forward, 1);
  const after = structuredClone(s); advance(after, 12);
  memory.outcome(choice, s, after, 12);
  const result = memory.describe(after);
  assert.equal(result.actions[0].weaponRequested, "lightning"); assert.equal(result.actions[0].weaponEquipped, false);
  const next = prepareDecision(after, result);
  assert.match(next.sharedState, /requested lightning not equipped/);
  assert.ok(next.eligible.some(c => c.id === "forward-fire")); assert.ok(next.grounding.weapon.criteria.w8);
});
