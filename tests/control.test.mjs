import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { candidates, prepareDecision, resolveSelection, rankDecision } from "../src/decisions.js";
import { CONTROL_MODE, OFFER_POLICY } from "../src/control.js";
import { perception, sceneText, ObservationMemory } from "../src/perception.js";
import { decisionReplies } from "./replies.mjs";
import { observation, visible, advance } from "./observations.mjs";

const prepare = s => prepareDecision(s);
function selected(s, selections, format = "choice") {
  const r = prepareDecision(s, null, { decisionFormat: format });
  r.responses = decisionReplies(r, selections);
  r.ranking = rankDecision(r); r.selectedIndex = r.ranking[0].index;
  return { record: r, choice: resolveSelection(r) };
}

test("one player-observable controller replaces all legacy modes/modules", () => {
  assert.equal(CONTROL_MODE, "player-observable");
  for (const path of ["assistance.js", "navigation.js", "unassisted.js"]) assert.equal(existsSync(new URL(`../src/${path}`, import.meta.url)), false);
  const r = prepare(observation()); assert.equal(r.controlMode, CONTROL_MODE); assert.equal(r.assistance, undefined);
  assert.equal(r.navigation, undefined); assert.equal(r.steering, undefined); assert.equal(r.offerPolicy, OFFER_POLICY);
  for (const path of ["../src/engine.js", "../src/agent.js", "../src/app.js", "../engine/qev_bridge.c"]) {
    const code = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(code, /qev_assistance|qev_probe|setAssistance|ExplorationMemory|prepareUnassisted/);
  }
});

test("the full unfiltered menu uses one shared state and separate explicit target/item/weapon choices", () => {
  const r = prepare(observation());
  assert.equal(r.requests.length, 4); assert.ok(r.requests.every(request => request.state === r.sharedState));
  assert.equal(r.candidates.length, 20); assert.equal(r.eligible.length, r.candidates.length);
  assert.ok(r.eligible.every(c => c.allowed && !c.geometry && !c.route && !c.offerNote));
  assert.deepEqual(Object.keys(r.requests[0].questions.action.criteria), r.eligible.map(c => c.optionId));
  assert.deepEqual(Object.keys(r.grounding.aim.criteria), ["e1"]);
  assert.deepEqual(Object.keys(r.grounding.item.criteria), ["p1"]);
  assert.deepEqual(Object.keys(r.grounding.weapon.criteria), ["w1", "w2"]);
  assert.ok(r.eligible.every(c => c.params.ticks === 12));
  assert.ok(prepareDecision(observation(), null, { realtime: true }).eligible.every(c => c.params.ticks === 45));
});

for (const [name, mutate] of [
  ["empty ammo", s => s.player.ammo = 0], ["critical health", s => s.player.health = 1],
  ["full health/armor", s => { s.player.health = 250; s.player.armor = 200; }],
  ["owned keys", s => { s.player.silverKey = true; s.player.goldKey = true; s.pickups[0].kind = "gold_key"; }],
  ["lava in every visible surface cell", s => s.scene.forEach(c => { c.fill(0); c[6] = 20000; })],
  ["airborne", s => s.player.grounded = false], ["underwater", s => s.player.inWater = true],
]) test(`${name} changes evidence, never removes or reorders tactics`, () => {
  const baseline = prepare(observation()), s = observation(); mutate(s); const r = prepare(s);
  assert.deepEqual(r.eligible.map(c => c.id), baseline.eligible.map(c => c.id));
  assert.deepEqual(r.eligible.map(c => c.params), baseline.eligible.map(c => c.params));
  assert.ok(r.eligible.every(c => c.allowed));
});

test("relative movement/look conventions and explicit jump/swim/weapon inputs match Quake", () => {
  const list = candidates(observation()), get = id => list.find(c => c.id === id).params;
  assert.equal(get("forward").forward, 1); assert.equal(get("back").forward, -1);
  assert.equal(get("left").side, -1); assert.equal(get("right").side, 1);
  assert.equal(get("turn-left").yawRate, 90); assert.equal(get("turn-right").yawRate, -90);
  assert.equal(get("look-up").pitchRate, -60); assert.equal(get("look-down").pitchRate, 60);
  assert.equal(get("jump").jump, true); assert.equal(get("jump").forward, 1);
  assert.equal(get("swim-up").up, 1); assert.equal(get("swim-down").up, -1);
  assert.ok(list.every(c => c.params.weapon === null), "every tactic awaits the concurrent explicit weapon answer");
  assert.ok(list.every(c => c.id !== "weapon"), "equipment must not consume a separate action");
  assert.equal(get("attack").ref, null, "no nearest/first-target default");
  assert.equal(get("fire").ref, 0); assert.equal(get("fire").fire, true);
  assert.ok(list.every(c => Math.hypot(c.params.forward, c.params.side) <= 1));
});

test("no contacts does not imply safety and never removes blind firing or locomotion", () => {
  const s = observation(); s.enemies = []; s.pickups = []; s.features = []; s.player.ammo = 0;
  const r = prepare(s);
  for (const id of ["fire", "forward-fire", "left-fire", "right-fire", "back-fire", "forward", "jump", "swim-up", "wait"]) assert.ok(r.eligible.some(c => c.id === id));
  assert.ok(r.eligible.every(c => c.params.ref === 0));
  assert.match(r.sharedState, /Unseen unknown/); assert.equal(r.grounding.aim, undefined);
});

test("hidden, stale, unsupported and malformed visual contacts never produce target capabilities", () => {
  for (const mutate of [s => s.enemies[0].visible = false, s => s.screen.available = false, s => s.screen.tick--,
    s => s.enemies[0].screen.pixels = 0, s => s.enemies[0].ref = null, s => s.enemies[0].ref = 1.2]) {
    const s = observation(); mutate(s);
    assert.equal(prepare(s).bindings.aim.length, 0);
  }
});

test("skipping an invalid screen row cannot bind its native reference to a different visible object", () => {
  const s = observation(); s.enemies[0].screen.pixels = 0;
  s.enemies.push(visible("monster_ogre", 77));
  const { choice } = selected(s, { action: "attack", aim: "e2" });
  assert.equal(choice.params.ref, 77);
});

for (const format of ["choice", "noul"]) test(`${format} preserves explicit weapon/item choices even when empty or already owned`, () => {
  const s = observation(); s.player.weapons.push({ id: 8, name: "lightning" }); s.player.cells = 0;
  let result = selected(s, { action: "forward", weapon: "w8" }, format);
  assert.equal(result.choice.params.weapon, 8); assert.equal(result.choice.params.ref, 0);
  assert.equal(result.choice.params.forward, 1); assert.equal(result.choice.weaponSelection.id, "w8");
  s.pickups.push(visible("mega_health", 88)); s.player.health = 250;
  result = selected(s, { action: "approach", item: "p2" }, format);
  assert.equal(result.choice.params.ref, 88); assert.equal(result.choice.params.forward, 1); assert.equal(result.choice.params.fire, false);
});

test("unowned/mislabelled weapons are not invented; owned inventory is copied and deduplicated", () => {
  const s = observation(); s.player.weapons.push({ id: 8, name: "FAKE" }, { id: 2, name: "shotgun" }, { id: 99, name: "rocket launcher" });
  const p = perception(s); assert.deepEqual(p.weapons, [{ id: 1, name: "axe" }, { id: 2, name: "shotgun" }]);
  p.weapons[0].name = "mutated"; assert.equal(s.player.weapons[0].name, "axe");
});

test("whitelisting never touches coordinates, exact angles/ranges, enemy health, hidden intentions or actor IDs", () => {
  const s = observation(), forbidden = () => assert.fail("privileged field read");
  for (const key of ["hiddenEnemies", "exit", "bsp", "navigation"]) Object.defineProperty(s, key, { get: forbidden });
  for (const key of ["position", "yaw", "pitch", "velocity"]) Object.defineProperty(s.player, key, { get: forbidden });
  for (const e of [...s.enemies, ...s.pickups]) for (const key of ["position", "distance", "bearingRight", "slot", "generation", "health", "intent", "cooldown"])
    Object.defineProperty(e, key, { get: forbidden });
  Object.defineProperty(s.player.powerups, "hidden", { enumerable: true, get: forbidden });
  const r = prepare(s); assert.match(r.sharedState, /grunt/); assert.equal(r.bindings.aim[0].ref, 10);
  const memory = new ObservationMemory(); memory.observe(s); memory.describe(s);
  assert.doesNotMatch(JSON.stringify(memory), /position|yaw|pitch|distance|"ref"|slot|generation/);
});

test("surface cells are final visible coverage descriptions, never walkability or cover claims", () => {
  const s = observation(); s.scene[6] = [0, 0, 0, 0, 0, 0, 20000, 0];
  const p = perception(s); assert.match(sceneText(p), /L lava/); assert.match(sceneText(p), /Not a safe-route test/);
  assert.notStrictEqual(p.scene[0], s.scene[0]);
  for (const invalid of [-1, NaN, 1e8, "lava"]) { s.scene[0][0] = invalid; assert.deepEqual(perception(s).scene, []); }
  s.screen.available = false; assert.deepEqual(perception(s).scene, []);
});

test("mixed sound captions contain stereo/loudness/age only, not invented source identities or front/back/range", () => {
  const s = observation();
  s.audio = { source: "mixed-sound-captions", available: true, events: [
    { kind: "weapon", direction: "left", loudness: "quiet", ageTicks: 12, position: "SECRET", sourceEntity: 22 },
    { kind: "creature_or_effect", direction: "behind", loudness: "clear", ageTicks: 0 },
    { kind: "mechanism", direction: "right", loudness: "clear", ageTicks: 121 },
  ] };
  assert.deepEqual(perception(s).sounds, [{ kind: "weapon", direction: "left", loudness: "quiet", ageTicks: 12 }]);
  assert.match(prepare(s).sharedState, /Heard: weapon left quiet/);
  assert.doesNotMatch(prepare(s).sharedState, /SECRET|behind|sourceEntity/);
  s.audio.source = "world-sound-events"; assert.deepEqual(perception(s).sounds, []);
});

test("last-seen memory records an old image-relative direction, never tracks a hidden contact or restores a target", () => {
  const s = observation(), memory = new ObservationMemory();
  s.enemies[0].screen.bounds = [0.1, 0.4, 0.2, 0.6]; s.enemies[0].screen.aimOverlap = false;
  memory.observe(s); advance(s, 12); s.enemies = []; memory.observe(s);
  const past = memory.describe(s); assert.equal(past.pastSightings[0].side, "left"); assert.equal(past.pastSightings[0].ageTicks, 12);
  const r = prepareDecision(s, past); assert.match(r.sharedState, /Previously seen, NOT tracked: grunt old-view left/);
  assert.equal(r.bindings.aim.length, 0); assert.equal(r.eligible.some(c => c.id === "attack"), false);
  advance(s, 60); assert.equal(memory.describe(s).pastSightings[0].side, "left", "no updating unseen location from a changed camera");
  assert.equal(memory.describe(s).pastSightings[0].ageTicks, 72);
});

test("repeated polls cannot fabricate observations, new places or action experience", () => {
  const s = observation(), memory = new ObservationMemory(); for (let i = 0; i < 100; i++) memory.observe(s);
  assert.equal(memory.past.length, 1); assert.equal(memory.actions.length, 0); assert.equal(memory.repeated, 0);
  memory.outcome({ label: "Jump" }, s, s, 0); assert.equal(memory.actions.length, 0);
  const before = structuredClone(s); advance(s, 12); s.player.health -= 5; s.player.ammo--;
  memory.outcome({ label: "Fire" }, before, s, 12);
  assert.deepEqual(memory.describe(s).actions[0], { tick: 54, action: "Fire", actionId: undefined, damage: 5, healthChange: -5, ammoChange: -1, weaponChanged: false, killsChange: null, sameView: true, ticksApplied: 12 });
});

test("observation/action memory has bounded retention and resets at discontinuities", () => {
  const s = observation(), memory = new ObservationMemory();
  for (let i = 0; i < 80; i++) {
    const before = structuredClone(s); advance(s, 12); s.enemies[0].screen.bounds[0] = i % 2 ? 0.3 : 0.4;
    memory.observe(s); memory.outcome({ label: "Forward" }, before, s, 12);
  }
  assert.ok(memory.past.length <= 16); assert.ok(memory.actions.length <= 8);
  advance(s, 1801); s.enemies = []; memory.observe(s); assert.equal(memory.describe(s).pastSightings.length, 0);
  assert.equal(memory.describe(s).actions.length, 0);
  s.epoch++; memory.observe(s); assert.equal(memory.actions.length, 0); assert.equal(memory.past.length, 1);
});
