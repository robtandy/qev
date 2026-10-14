import assert from "node:assert/strict";
import test from "node:test";
import { prepareDecision, resolveSelection } from "../src/decisions.js";
import { WEAPON_PROFILES, WEAPON_GUIDANCE, weaponInventory, weaponOption } from "../src/weapons.js";
import { perception, viewText, ObservationMemory } from "../src/perception.js";
import { observation, visible, advance } from "./observations.mjs";
import { decisionReplies } from "./replies.mjs";

const inventoryLine = state => state.split("\n").find(line => line.startsWith("Owned weapons:"));
const knownInventory = () => WEAPON_PROFILES.map(({ id, name }) => ({ id, name }));

for (const format of ["choice", "noul"]) test(`${format}: every question sees the complete owned inventory, held weapon and all ammunition pools`, () => {
  const s = observation(); Object.assign(s.player, { weapon: "axe", ammo: 0, shells: 17, nails: 29, rockets: 3, cells: 41, weapons: knownInventory() });
  const r = prepareDecision(s, null, { decisionFormat: format }), expected = weaponInventory(s.player.weapons);
  for (const request of r.requests) {
    assert.equal(inventoryLine(request.state), `${expected} ${WEAPON_GUIDANCE}`);
    assert.match(request.state, /held axe \(contact-only melee, not ranged\), no ammo needed/);
    assert.match(request.state, /shells\/nails\/rockets\/cells 17\/29\/3\/41/);
  }
  assert.deepEqual(Object.keys(r.grounding.weapon.criteria), s.player.weapons.map(w => `w${w.id}`));
  assert.match(r.grounding.weapon.instructions, /strongest effective loaded gun/);
  assert.match(r.grounding.weapon.instructions, /reach and self-harm/);
  assert.match(r.grounding.weapon.criteria.w1, /weak contact-only melee/);
});

test("all 255 nonempty inventory subsets are faithfully represented without assuming ownership from ammunition", () => {
  for (let mask = 1; mask < 256; mask++) {
    const s = observation(); s.player.weapons = knownInventory().filter(w => mask & (1 << (w.id - 1)));
    s.player.weapon = s.player.weapons[0].name;
    Object.assign(s.player, { shells: 100, nails: 200, rockets: 50, cells: 100 });
    const r = prepareDecision(s);
    assert.equal(inventoryLine(r.sharedState), `Owned weapons: ${s.player.weapons.map(w => w.name).join(", ")}. ${WEAPON_GUIDANCE}`);
    assert.equal(r.bindings.weapon.length, s.player.weapons.length > 1 ? s.player.weapons.length : 0);
    assert.ok(r.requests.every(request => inventoryLine(request.state) === inventoryLine(r.sharedState)));
  }
});

test("visible weapon pickups and spare ammo do not become owned guns in any decision head", () => {
  const s = observation(); s.player.nails = 100; s.player.rockets = 40;
  s.pickups.push(visible("weapon_supershotgun", 29), visible("weapon_rocketlauncher", 30));
  const r = prepareDecision(s);
  assert.ok(r.sharedState.includes("double shotgun"), "the pickup remains visible evidence");
  assert.equal(inventoryLine(r.sharedState), `Owned weapons: axe, shotgun. ${WEAPON_GUIDANCE}`);
  assert.deepEqual(r.bindings.weapon.map(w => w.name), ["axe", "shotgun"]);
  assert.ok(r.bindings.item.some(item => item.ref === 29));
});

test("inventory uses the same validated/deduplicated HUD entries as equipment offers, without reading private fields", () => {
  const s = observation();
  s.player.weapons.push({ id: 2, name: "shotgun" }, { id: 99, name: "rocket launcher" }, { id: 8, name: "FAKE" });
  const forbidden = () => assert.fail("inventory must not query a world/entity/range field");
  for (const key of ["items", "position", "serverWeapon", "bestWeapon", "canShoot"]) Object.defineProperty(s.player, key, { get: forbidden });
  for (const key of ["health", "distance", "range", "canHit"]) Object.defineProperty(s.enemies[0], key, { get: forbidden });
  const r = prepareDecision(s);
  assert.equal(inventoryLine(r.sharedState), `Owned weapons: axe, shotgun. ${WEAPON_GUIDANCE}`);
  assert.deepEqual(Object.keys(r.grounding.weapon.criteria), ["w1", "w2"]);
  s.player.weapons[0].name = "mutated";
  assert.equal(inventoryLine(r.sharedState), `Owned weapons: axe, shotgun. ${WEAPON_GUIDANCE}`, "historical requests stay unchanged");
});

test("missing/empty inventory is reported as unavailable, never guessed from the held name or ammo", () => {
  for (const weapons of [undefined, null, []]) {
    const s = observation(); s.player.weapons = weapons;
    const r = prepareDecision(s);
    assert.equal(inventoryLine(r.sharedState), `Owned weapons: not reported. ${WEAPON_GUIDANCE}`);
    assert.equal(r.grounding.weapon, undefined);
    assert.ok(r.sharedState.includes("held shotgun"), "the actual HUD-held label is separate evidence");
  }
});

for (const weapon of ["axe", "shotgun"]) test(`one owned ${weapon} remains known without an artificial equipment question`, () => {
  const s = observation(), profile = WEAPON_PROFILES.find(w => w.name === weapon);
  s.player.weapons = [{ id: profile.id, name: profile.name }]; s.player.weapon = weapon;
  const r = prepareDecision(s); r.responses = decisionReplies(r, { action: "forward" });
  const chosen = resolveSelection(r);
  assert.equal(inventoryLine(r.sharedState), `Owned weapons: ${weapon}. ${WEAPON_GUIDANCE}`);
  assert.equal(chosen.params.weapon, 0); assert.equal(chosen.weaponSelection, null); assert.equal(r.sampling.heads.weapon, undefined);
});

test("new pickups and episode resets update inventory from the fresh HUD, not sightings or old requests", () => {
  const s = observation(), before = prepareDecision(s);
  advance(s, 12); s.player.weapons.push({ id: 3, name: "double shotgun" }); s.player.weapon = "double shotgun";
  const pickedUp = prepareDecision(s);
  assert.equal(inventoryLine(before.sharedState), `Owned weapons: axe, shotgun. ${WEAPON_GUIDANCE}`);
  assert.equal(inventoryLine(pickedUp.sharedState), `Owned weapons: axe, shotgun, double shotgun. ${WEAPON_GUIDANCE}`);
  assert.match(pickedUp.sharedState, /held double shotgun/); assert.match(pickedUp.grounding.weapon.criteria.w3, /\(held\)$/);
  const reset = observation(); reset.epoch++;
  assert.equal(inventoryLine(prepareDecision(reset).sharedState), inventoryLine(before.sharedState));
});

test("a refused switch retains the actual held weapon and full owned inventory, not an imagined equip", () => {
  const before = observation(), memory = new ObservationMemory(); memory.observe(before);
  const after = structuredClone(before); advance(after, 12);
  after.player.weapons.push({ id: 3, name: "double shotgun" }); after.player.shells = after.player.ammo = 1;
  memory.outcome({ id: "attack", label: "Attack", weaponSelection: { name: "double shotgun" } }, before, after, 12);
  const r = prepareDecision(after, memory.describe(after));
  assert.match(r.sharedState, /held shotgun/); assert.match(r.sharedState, /requested double shotgun not equipped/);
  assert.ok(inventoryLine(r.sharedState).includes("double shotgun"));
  assert.match(r.grounding.weapon.criteria.w3, /1 shells; switch needs 2/);
});

for (const name of ["double shotgun", "super nailgun"]) test(`${name}: static strength and switch minimum are evidence, not an automatic weapon ranking/veto`, () => {
  const profile = WEAPON_PROFILES.find(w => w.name === name), weapon = { weapon: profile.id, name }, s = observation();
  assert.match(profile.reach, /stronger ranged/);
  s.player.weapons.push({ id: profile.id, name }); s.player[profile.ammo] = 1;
  assert.match(weaponOption(weapon, s.player), /switch needs 2/);
  assert.ok(prepareDecision(s).grounding.weapon.criteria[`w${profile.id}`]);
  s.player.weapon = name;
  assert.doesNotMatch(weaponOption(weapon, s.player), /needs|EMPTY/, "already held: native one-round fallback still fires");
  s.player[profile.ammo] = 0;
  assert.match(weaponOption(weapon, s.player), /EMPTY/); assert.ok(prepareDecision(s).grounding.weapon.criteria[`w${profile.id}`]);
  s.player[profile.ammo] = undefined;
  assert.match(weaponOption(weapon, s.player), new RegExp(`unknown ${profile.ammo}`)); assert.doesNotMatch(weaponOption(weapon, s.player), /needs|EMPTY/);
});

test("best-weapon guidance does not disable weapon sampling, rewrite probabilities or replace a lower-rated axe draw", () => {
  const r = prepareDecision(observation()); r.responses = decisionReplies(r, { action: "engage", weapon: "w2" });
  const answer = r.responses.find(r => r.answers.weapon).answers.weapon;
  answer.probabilities = { w1: 0.05, w2: 0.95 };
  const raw = structuredClone(r.responses), draws = [0.5, 0.5, 0.01];
  const chosen = resolveSelection(r, { random: () => draws.shift() });
  assert.equal(chosen.params.weapon, 1); assert.equal(chosen.weaponSelection.id, "w1");
  assert.equal(chosen.weaponSelection.answer.choice, "w2"); assert.equal(r.sampling.heads.weapon.draw, 0.01);
  assert.equal(r.sampling.heads.weapon.method, "categorical-v1"); assert.equal(draws.length, 0);
  assert.deepEqual(r.responses, raw);
});

test("shared visual prose factors identical attributes without dropping kinds/counts or merging unlike poses/groups", () => {
  const s = observation(); s.enemies = [visible("monster_army", 1, undefined, { pose: "attack" }),
    visible("monster_army", 2, undefined, { pose: "attack" }), visible("monster_ogre", 3, undefined, { pose: "attack" }),
    visible("monster_zombie", 4, undefined, { pose: "downed" }), visible("monster_knight", 5, undefined, { pose: "dead" })];
  s.pickups.push(visible("item_shells", 20)); s.features = [visible("projectile", 30)];
  const seen = perception(s), text = viewText(seen);
  assert.match(text, /center medium attacking: 2x grunt, ogre/);
  assert.match(text, /zombie center medium downed, may revive/);
  assert.match(text, /knight center medium dead\/corpse/);
  assert.match(text, /center medium: health, shells/);
  assert.match(text, /projectile center medium/);
  const r = prepareDecision(s); assert.equal(r.visual.entities.length, 8);
  assert.equal(r.bindings.aim.length, 4); assert.equal(r.bindings.item.length, 2);
  assert.ok(r.requests.every(request => request.state.includes(text)));
});

test("different image-relative positions, sizes and size trends retain separate descriptions", () => {
  const s = observation(), enemy = visible("monster_ogre", 12, [0.05, 0.1, 0.09, 0.13]);
  enemy.screen.aimOverlap = false; s.enemies.push(enemy);
  const seen = perception(s); seen.contacts[0].trend = "growing";
  assert.match(viewText(seen), /grunt center medium growing/);
  assert.match(viewText(seen), /ogre left tiny/);
});
