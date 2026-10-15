import assert from "node:assert/strict";
import test from "node:test";
import { prepareDecision, resolveSelection } from "../src/decisions.js";
import { strongestLoadedWeapon, WEAPON_POWER_ORDER, WEAPON_PROFILES } from "../src/weapons.js";
import { ObservationMemory } from "../src/perception.js";
import { observation, advance } from "./observations.mjs";
import { decisionReplies } from "./replies.mjs";

function resolve(s, action, format = "choice") {
  const record = prepareDecision(s, null, { decisionFormat: format });
  record.responses = decisionReplies(record, { action });
  const raw = structuredClone(record.responses), choice = resolveSelection(record);
  assert.deepEqual(record.responses, raw);
  return { record, choice };
}
for (const format of ["choice", "noul"]) test(`${format}: automatic equipment preserves every chosen tactic's movement, attack and duration`, () => {
  const s = observation(), menu = prepareDecision(s).eligible;
  assert.ok(menu.every(c => c.id !== "weapon"));
  for (const candidate of menu) {
    const { record, choice } = resolve(s, candidate.id, format);
    assert.equal(choice.id, candidate.id);
    for (const field of ["forward", "side", "up", "yawRate", "pitchRate", "fire", "jump", "ticks", "meleeApproach"])
      assert.equal(choice.params[field], candidate.params[field], `${candidate.id}: ${field}`);
    assert.equal(choice.params.weapon, 2); assert.equal(choice.weaponSelection.id, "w2");
    assert.equal(choice.weaponSelection.method, "strongest-loaded-v1"); assert.equal(choice.weaponSelection.answer, undefined);
    assert.equal(choice.selection?.binding ?? null, candidate.binding);
    assert.match(choice.label, / · auto shotgun$/);
    assert.ok(record.requests.every(r => !r.questions.weapon));
    assert.deepEqual(Object.keys(record.sampling.heads), ["action"]);
  }
});

test("wait can automatically switch to a loaded stronger weapon without movement or attack", () => {
  const s = observation(); s.player.weapon = "axe";
  const { choice } = resolve(s, "wait");
  assert.equal(choice.id, "wait"); assert.equal(choice.params.weapon, 2);
  assert.equal(choice.params.forward, 0); assert.equal(choice.params.fire, false);
  assert.equal(choice.label, "Wait · auto shotgun");
});

test("a singleton loaded inventory still declares its desired weapon; the native HUD check avoids a redundant press", () => {
  const s = observation(); s.player.weapons = [{ id: 2, name: "shotgun" }];
  const { record, choice } = resolve(s, "forward");
  assert.equal(record.requests.length, 1); assert.equal(choice.params.weapon, 2);
  assert.equal(choice.weaponSelection.method, "strongest-loaded-v1"); assert.equal(choice.params.forward, 1);
});

test("the explicit fixed power order selects each highest loaded owned weapon, never an empty or unowned gun", () => {
  const s = observation(); s.player.weapons = WEAPON_PROFILES.map(({ id, name }) => ({ id, name }));
  Object.assign(s.player, { weapon: "axe", shells: 10, nails: 10, rockets: 10, cells: 10 });
  assert.deepEqual(WEAPON_POWER_ORDER, [8, 7, 6, 5, 4, 3, 2, 1]);
  for (const expected of WEAPON_POWER_ORDER) {
    assert.equal(strongestLoadedWeapon(s.player.weapons, s.player).weapon, expected);
    s.player.weapons = s.player.weapons.filter(w => w.id !== expected);
  }
  assert.equal(strongestLoadedWeapon([], s.player), null);
  const axe = [{ id: 1, name: "axe" }];
  for (const ammo of [0, -1, undefined, null, NaN, Infinity, "3", 0.5]) {
    s.player.weapons = [...axe, { id: 8, name: "lightning" }]; s.player.cells = ammo;
    assert.equal(strongestLoadedWeapon(s.player.weapons, s.player).weapon, 1);
    assert.equal(strongestLoadedWeapon(s.player.weapons.slice(1), s.player), null);
  }
});

for (const id of [3, 5]) test(`upgraded weapon ${id} needs two rounds to switch, but a held one-round fallback remains usable`, () => {
  const s = observation(), profile = WEAPON_PROFILES[id - 1];
  s.player.weapons.push({ id, name: profile.name }); s.player[profile.ammo] = 1;
  assert.notEqual(strongestLoadedWeapon(s.player.weapons, s.player).weapon, id);
  s.player[profile.ammo] = 2;
  assert.equal(strongestLoadedWeapon(s.player.weapons, s.player).weapon, id);
  s.player.weapon = profile.name; s.player[profile.ammo] = 1;
  assert.equal(strongestLoadedWeapon(s.player.weapons, s.player).weapon, id);
  s.player[profile.ammo] = 0;
  assert.notEqual(strongestLoadedWeapon(s.player.weapons, s.player).weapon, id);
});

test("power selection is intentionally not a tactical range, splash or underwater-safety optimizer", () => {
  const s = observation(); s.player.inWater = true;
  s.player.weapons.push({ id: 8, name: "lightning" }); s.player.cells = 1;
  assert.equal(resolve(s, "fire").choice.params.weapon, 8);
});

test("native refusal remains observable; the controller never fabricates a successful equip", () => {
  const s = observation(); s.player.weapons.push({ id: 8, name: "lightning" }); s.player.cells = 10;
  const { choice } = resolve(s, "forward-fire"), memory = new ObservationMemory(); memory.observe(s);
  const after = structuredClone(s); advance(after, 12);
  memory.outcome(choice, s, after, 12);
  const result = memory.describe(after);
  assert.equal(result.actions[0].weaponRequested, "lightning"); assert.equal(result.actions[0].weaponEquipped, false);
  assert.match(prepareDecision(after, result).sharedState, /requested lightning not equipped/);
});
