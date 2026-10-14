import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareDecision, rankDecision, resolveSelection } from "../src/decisions.js";
import { Engine } from "../src/engine.js";
import { Agent } from "../src/agent.js";
import { decisionReplies, replies } from "./replies.mjs";
import { observation, visible, advance } from "./observations.mjs";

for (const format of ["choice", "noul"]) test(`${format}: engagement explicitly carries melee approach without changing the chosen target or weapon`, () => {
  const s = observation(); s.enemies.push(visible("monster_ogre", 37)); s.player.shells = 0;
  const r = prepareDecision(s, null, { decisionFormat: format });
  r.responses = decisionReplies(r, { action: "engage", aim: "e2", weapon: "w2" });
  const raw = structuredClone(r.responses); r.selectedIndex = rankDecision(r)[0].index;
  const selected = resolveSelection(r);
  assert.equal(selected.id, "engage"); assert.equal(selected.params.meleeApproach, true);
  assert.equal(selected.params.ref, 37); assert.equal(selected.params.weapon, 2);
  assert.equal(selected.params.forward, 0, "raw input remains zero; the declared flag is executed against the current HUD");
  assert.equal(selected.params.fire, true); assert.match(selected.label, /Engage: aim and attack, close in with axe/);
  assert.deepEqual(r.responses, raw); assert.equal(selected.selection.id, "e2");
  assert.equal(selected.weaponSelection.id, "w2", "an empty requested shotgun is not silently replaced by the axe");
  assert.ok(r.requests.every(request => request.state === r.sharedState || format === "noul"));
});

test("engagement is an additional explicit choice; no raw or stationary attack acquires automatic movement", () => {
  const s = observation(); s.player.weapon = "axe";
  const r = prepareDecision(s);
  assert.equal(r.eligible.length, 20);
  assert.deepEqual(r.eligible.filter(c => c.params.meleeApproach).map(c => c.id), ["engage"]);
  const stationary = r.eligible.find(c => c.id === "attack");
  assert.equal(stationary.label, "Hold position and attack"); assert.equal(stationary.params.forward, 0);
  assert.equal(stationary.params.meleeApproach, undefined); assert.equal(stationary.params.fire, true);
  r.responses = decisionReplies(r, { action: "attack", weapon: "w1" }); r.selectedIndex = rankDecision(r)[0].index;
  const chosen = resolveSelection(r); assert.equal(chosen.id, "attack"); assert.equal(chosen.params.forward, 0);
  assert.equal(chosen.params.meleeApproach, undefined);
  assert.equal(r.eligible.find(c => c.id === "forward-fire").params.forward, 1);
});

for (const change of [s => s.enemies = [], s => s.enemies[0].pose = "dead", s => s.enemies[0].visible = false,
  s => s.enemies[0].ref = null, s => s.screen.available = false]) test("engagement requires a currently visible non-fallen enemy binding", () => {
  const s = observation(); change(s); const r = prepareDecision(s);
  assert.equal(r.eligible.some(c => c.id === "engage"), false);
  assert.ok(r.eligible.some(c => c.id === "fire")); assert.ok(r.eligible.some(c => c.id === "forward"));
});

test("a missing/contradictory engagement binding rejects rather than finding another target or equipment", () => {
  for (const question of ["aim", "weapon"]) {
    const r = prepareDecision(observation()); r.responses = decisionReplies(r, { action: "engage" });
    r.selectedIndex = rankDecision(r)[0].index;
    delete r.responses.find(response => response.answers[question]).answers[question];
    assert.throws(() => resolveSelection(r), new RegExp(`Invalid ${question} selection`));
  }
});

test("the native command bit is explicit, defaults off for old raw callers, and rejects malformed values", () => {
  const engine = new Engine({}), r = prepareDecision(observation());
  const p = { ...r.eligible.find(c => c.id === "engage").params, ref: 10, weapon: 1 };
  assert.equal(engine.commandValues(p).at(-1), 1);
  assert.equal(engine.commandValues({ ...p, meleeApproach: false }).at(-1), 0);
  const plain = { ...p }; delete plain.meleeApproach; assert.equal(engine.commandValues(plain).at(-1), 0);
  for (const value of [null, 0, 1, "true", {}, NaN]) assert.throws(() => engine.commandValues({ ...p, meleeApproach: value }), /Invalid action parameters/);
});

test("the engagement flag is fixed before inference and never computed from target range, ammo or danger", () => {
  const s = observation(), forbidden = () => assert.fail("Hidden target/range field read");
  for (const key of ["distance", "range", "inMeleeReach", "health", "deadflag", "position", "canReach"]) Object.defineProperty(s.enemies[0], key, { get: forbidden });
  const r = prepareDecision(s), candidate = r.eligible.find(c => c.id === "engage");
  assert.equal(candidate.params.meleeApproach, true); assert.match(candidate.choiceText, /close in with axe/);
  const c = readFileSync(new URL("../engine/qev_bridge.c", import.meta.url), "utf8");
  const movement = c.slice(c.indexOf("int melee_forward ="), c.indexOf("/* Equipment accompanies movement/aim"));
  assert.match(movement, /melee_approach && active_weapon\(\) == IT_AXE/);
  assert.match(movement, /melee_forward \? 1 : input_forward/);
  assert.doesNotMatch(movement, /EDICT_NUM|->v\.|distance|range|ammo|SV_Move|contact\(/);
  assert.match(c, /approach_melee && \(!enemy_contact\(ref\) \|\| !attack \|\| forward \|\| side \|\| up \|\| yaw_rate \|\| pitch_rate \|\| jump\)/);
  assert.match(c, /motion_requested = melee_forward \|\|/); assert.match(c, /eval_motion_requested = motion_requested/);
  assert.match(c, /action_ticks = weapon_presses = melee_approach_ticks = 0/);
});

test("all equipped-weapon comparisons normalize Quake's one-byte axe HUD value without reading server equipment", () => {
  const c = readFileSync(new URL("../engine/qev_bridge.c", import.meta.url), "utf8");
  const decoder = c.slice(c.indexOf("static int active_weapon"), c.indexOf("static const char *weapon_name"));
  assert.match(decoder, /standard_quake && value == 0 && \(cl\.items & IT_AXE\) \? IT_AXE : value/);
  assert.doesNotMatch(decoder, /->v\.|EDICT_NUM|weaponmodel|origin/);
  assert.equal((c.match(/cl\.stats\[STAT_ACTIVEWEAPON\]/g) || []).length, 1, "only the shared decoder reads the raw protocol value");
  assert.match(c, /weapon_name\(active_weapon\(\)\)/); assert.match(c, /active_weapon\(\) != weapons\[selected_weapon-1\]/);
});

test("inspection and live records retain actual melee-advance input ticks separately from action duration", async () => {
  const state = observation();
  const engine = { snapshot: () => structuredClone(state), pause() {}, async act(p) {
    assert.equal(p.meleeApproach, true); advance(state, 12);
    state.actionTicks = 12; state.meleeApproachTicks = 8; return structuredClone(state);
  } };
  const model = { decideMany: async requests => replies(requests, null, { action: Object.entries(requests[0].questions.action.criteria).find(([, text]) => text.startsWith("Engage:"))[0] }) };
  const agent = new Agent({ engine, getModel: () => model }), r = await agent.score(); await agent.step();
  assert.equal(r.execution.ticksApplied, 12); assert.equal(r.execution.meleeApproachTicks, 8);
  const live = { ...r, mode: "realtime", appliedAt: r.before, actionSerial: 7 };
  agent.active = live;
  agent.finishLive({ ...state, actionSerial: 7, actionTicks: 20, meleeApproachTicks: 14, actionTicksLeft: 0 }, "ended");
  assert.equal(live.execution.meleeApproachTicks, 14);
  agent.active = { ...live }; const replaced = agent.active;
  agent.finishLive({ ...state, actionSerial: 8, meleeApproachTicks: 0 }, "another command");
  assert.equal(replaced.execution.meleeApproachTicks, null, "another command's counter cannot be attributed to engagement");
});
