import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareDecision, rankDecision, resolveSelection } from "../src/decisions.js";
import { WEAPON_PROFILES, weaponReach } from "../src/weapons.js";
import { perception, ObservationMemory } from "../src/perception.js";
import { ScreenMemory, fallenEnemy, describeScreenEntity } from "../src/screen.js";
import { observation, visible, advance } from "./observations.mjs";
import { decisionReplies } from "./replies.mjs";

for (const weapon of WEAPON_PROFILES) test(`${weapon.name}: reach is shared with every decision head, not isolated in equipment`, () => {
  const s = observation(); s.player.weapon = weapon.name;
  s.player.weapons = WEAPON_PROFILES.map(({ id, name }) => ({ id, name }));
  const r = prepareDecision(s);
  assert.equal(r.requests.length, 4);
  for (const request of r.requests) {
    assert.equal(request.state, r.sharedState);
    assert.ok(request.state.includes(`${weapon.name} (${weapon.reach})`));
    assert.match(request.state, /crosshair not melee contact/);
  }
  for (const w of WEAPON_PROFILES) assert.ok(r.grounding.weapon.criteria[`w${w.id}`].includes(w.reach));
  assert.equal(r.eligible.length, 20);
});

test("tactic labels describe weapon-neutral attacks, not imaginary ranged firing with an axe", () => {
  for (const name of ["axe", "shotgun"]) {
    const s = observation(); s.player.weapon = name; const r = prepareDecision(s);
    for (const c of r.eligible.filter(c => c.params.fire)) {
      assert.match(c.label, /[Aa]ttack|Engage/); assert.doesNotMatch(c.label, /fire|firing/i);
    }
    assert.equal(r.eligible.find(c => c.id === "attack").params.forward, 0);
    assert.equal(r.eligible.find(c => c.id === "forward-fire").params.forward, 1);
  }
});

test("axe-only inventory still explains contact-only melee and does not invent ammunition or target reach", () => {
  const s = observation(); s.player.weapon = "axe"; s.player.ammo = s.player.shells = 0;
  s.player.weapons = [{ id: 1, name: "axe" }];
  const forbidden = () => assert.fail("No distance/contact/hit probe is allowed");
  for (const key of ["range", "distance", "inMeleeReach", "canHit", "health", "deadflag"]) Object.defineProperty(s.enemies[0], key, { get: forbidden });
  const r = prepareDecision(s);
  assert.equal(r.grounding.weapon, undefined);
  assert.match(r.requests[0].state, /axe \(contact-only melee, not ranged\), no ammo needed/);
  assert.ok(r.eligible.some(c => c.id === "attack")); // Input stays legal even if the model chooses badly.
  assert.equal(weaponReach("unknown mod weapon"), "reach unknown");
});

test("a refused firearm request describes the actual HUD axe next time, not an imaginary ranged weapon", () => {
  const before = observation(), memory = new ObservationMemory(); memory.observe(before);
  const after = structuredClone(before); advance(after, 12); after.player.weapon = "axe"; after.player.ammo = after.player.shells = 0;
  memory.outcome({ id: "attack", label: "Attack", weaponSelection: { name: "shotgun" } }, before, after, 12);
  const r = prepareDecision(after, memory.describe(after));
  assert.match(r.sharedState, /axe \(contact-only melee, not ranged\)/);
  assert.match(r.sharedState, /requested shotgun not equipped/);
  assert.match(r.grounding.weapon.criteria.w2, /EMPTY/);
  assert.match(r.grounding.weapon.criteria.w1, /no ammo needed \(held\)/);
});

for (const pose of ["death", "dead"]) test(`${pose}: a visible fallen body is retained as evidence, not offered as an active enemy`, () => {
  const s = observation(); s.enemies[0].pose = pose;
  s.enemies.push(visible("monster_knight", 27, undefined, { pose: "hurt" }));
  const r = prepareDecision(s), contacts = perception(s).contacts.filter(c => c.group === "enemy");
  assert.equal(contacts.length, 2); assert.equal(fallenEnemy(contacts[0]), true);
  assert.equal(r.visual.entities[0].pose, pose);
  assert.deepEqual(r.bindings.aim.map(e => [e.id, e.ref]), [["e2", 27]]);
  assert.match(r.sharedState, pose === "dead" ? /grunt center medium dead\/corpse/ : /grunt center medium dying/);
  r.responses = decisionReplies(r, { action: "attack", aim: "e2", weapon: "w1" });
  const raw = structuredClone(r.responses); r.selectedIndex = rankDecision(r)[0].index;
  const choice = resolveSelection(r);
  assert.equal(choice.params.ref, 27); assert.equal(choice.params.weapon, 1); assert.equal(choice.params.forward, 0);
  assert.deepEqual(r.responses, raw, "never rewrite the SDK response or add movement to stationary melee");
  const invalid = prepareDecision(s); invalid.responses = structuredClone(raw);
  invalid.responses.find(x => x.answers.aim).answers.aim = { type: "choice", choice: "e1", probabilities: { e1: 1 } };
  assert.throws(() => resolveSelection(invalid), /Invalid aim selection/);
});

test("only corpses removes the active-enemy binding, not raw firing/movement or the visible bodies", () => {
  const s = observation(); s.enemies[0].pose = "dead";
  const r = prepareDecision(s);
  assert.equal(r.grounding.aim, undefined); assert.equal(r.eligible.some(c => c.id === "attack"), false);
  for (const id of ["fire", "forward-fire", "back-fire", "left-fire", "right-fire", "forward", "wait"]) {
    const c = r.eligible.find(c => c.id === id); assert.ok(c); assert.equal(c.params.ref, 0);
  }
  assert.match(r.sharedState, /dead\/corpse/);
});

for (const pose of ["unknown", "idle", "hurt", "downed", "unrecognized"]) test(`${pose}: uncertainty, pain and downed zombies are not deaths`, () => {
  const s = observation(); s.enemies[0].kind = "monster_zombie"; s.enemies[0].pose = pose;
  const r = prepareDecision(s);
  assert.equal(r.bindings.aim.length, 1); assert.equal(fallenEnemy(r.bindings.aim[0]), false);
  if (pose === "downed") {
    assert.match(r.sharedState, /downed, may revive/); assert.match(r.grounding.aim.criteria.e1, /downed, may revive/);
  }
});

test("neither offscreen disappearance nor a scoreboard increment establishes which enemy died", () => {
  const s = observation(); s.player.kills = 0; const memory = new ObservationMemory(); memory.observe(s);
  const after = structuredClone(s); advance(after, 12); after.player.kills = 1;
  memory.outcome({ id: "attack", label: "Attack" }, s, after, 12);
  let r = prepareDecision(after, memory.describe(after));
  assert.equal(r.bindings.aim.length, 1); assert.equal(r.bindings.aim[0].pose, "unknown");
  assert.match(r.sharedState, /scoreboard kills \+1/); assert.doesNotMatch(r.sharedState, /dying|corpse|enemy killed/);
  after.enemies = []; memory.observe(after); r = prepareDecision(after, memory.describe(after));
  assert.equal(r.bindings.aim.length, 0); assert.match(r.sharedState, /Previously seen, NOT tracked/);
  assert.doesNotMatch(r.sharedState, /dying|corpse|enemy killed/);
});

test("a death pose changes observation memory even at identical screen bounds; old corpses stay described as corpses", () => {
  const s = observation(), memory = new ObservationMemory(); memory.observe(s);
  const before = structuredClone(s); advance(s, 12); s.enemies[0].pose = "dead"; memory.observe(s);
  memory.outcome({ id: "attack", label: "Attack" }, before, s, 12);
  assert.equal(memory.describe(s).actions[0].sameView, false); assert.equal(memory.repeated, 0);
  advance(s, 12); s.enemies = []; memory.observe(s);
  assert.match(prepareDecision(s, memory.describe(s)).sharedState, /grunt dead\/corpse old-view/);
  assert.equal(memory.describe(s).pastSightings[0].pose, "dead");
});

test("falling/animation changes cannot masquerade as an enemy growing closer", () => {
  for (const pose of ["death", "dead", "downed", "hurt"]) {
    const s = observation(), memory = new ScreenMemory(); memory.observe(s);
    advance(s, 6); memory.observe(s); advance(s, 6); s.enemies[0].pose = pose; memory.observe(s);
    const e = memory.describe(s).entities[0]; assert.equal(e.trend, "uncertain"); assert.deepEqual(e.evidence, []);
    if (pose === "dead") assert.match(describeScreenEntity(e), /dead\/corpse/);
  }
});

test("native death completion uses only current visible animation and never swaps in a target or inspects health", () => {
  const c = readFileSync(new URL("../engine/qev_bridge.c", import.meta.url), "utf8");
  const completion = c.slice(c.indexOf("static int fallen_contact"), c.indexOf("/* Called only for nonzero"));
  assert.match(completion, /view_available\(\)/); assert.match(completion, /objects\[i\]\.count/);
  assert.match(completion, /Qev_FallenAnimation\(view_poses\[i\]\)/);
  assert.doesNotMatch(completion, /EDICT_NUM|->v\.|health|deadflag|nextthink|origin|trace_ent/);
  assert.match(c, /attack && fallen_contact\(ref\)/);
  assert.match(c, /firing && fallen_contact\(selected_ref\)/);
  assert.match(c, /cancel_action\("Chosen enemy is visibly dead or dying\."\); return/);
  assert.match(c, /frames\[entity->frame\]\.type != ALIAS_SINGLE/);
});
