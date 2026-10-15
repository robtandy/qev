import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gradeGameplay, GAMEPLAY_BAR } from "../scripts/gameplay-report.mjs";
import { prepareDecision } from "../src/decisions.js";
import { observation, visible } from "./observations.mjs";

const trial = () => ({ start: { player: { kills: 0 } }, end: { alive: true, player: { kills: 3 } },
  metrics: { testOnly: true, distance: 400, maxDisplacement: 200, movingTicks: 100, attackTicks: 100 },
  longestNoProgress: 5, records: [{ status: "executed", appliedAt: { tick: 1 }, execution: { ticksApplied: 45 } }] });

test("the gameplay bar requires confirmed kills, actual locomotion, attack input and survival", () => {
  assert.equal(gradeGameplay(trial()).passed, true);
  assert.equal(GAMEPLAY_BAR.kills, 2); assert.equal(GAMEPLAY_BAR.stallSeconds, 15);
  for (const [label, mutate] of [
    ["no kills", t => t.end.player.kills = 0],
    ["only standing and shooting", t => { t.metrics.movingTicks = 0; t.metrics.maxDisplacement = 0; }],
    ["knockback is not commanded movement", t => t.metrics.movingTicks = 0],
    ["moving against a wall", t => t.metrics.maxDisplacement = 10],
    ["enemy deaths without attacking", t => t.metrics.attackTicks = 0],
    ["idle stall", t => t.longestNoProgress = 16],
    ["death", t => t.end.alive = false],
    ["model error", t => t.records[0].status = "error"],
    ["accepted but unexecuted", t => t.records[0].execution.ticksApplied = 0],
  ]) { const t = trial(); mutate(t); assert.equal(gradeGameplay(t).passed, false, label); }
});

test("missing/NaN evaluation data cannot accidentally pass a gameplay test", () => {
  for (const mutate of [t => delete t.end.player.kills, t => t.metrics = null, t => t.metrics.testOnly = false,
    t => t.metrics.distance = NaN, t => t.metrics.attackTicks = Infinity, t => t.longestNoProgress = undefined]) {
    const t = trial(); mutate(t); assert.equal(gradeGameplay(t).passed, false);
  }
});

test("ammo consumption and decision counts cannot substitute for actual game-confirmed kills", () => {
  const t = trial(); t.start.player.ammo = 25; t.end.player.ammo = 0; t.end.player.kills = 0;
  t.records = Array.from({ length: 200 }, () => t.records[0]);
  assert.equal(gradeGameplay(t).passed, false);
});

test("scoreboard and unsuccessful own-motion feedback describe observations without filtering choices", () => {
  const s = observation(), before = prepareDecision(s);
  Object.assign(s.player, { kills: 3, moving: false, noMovementTicks: 120 });
  const after = prepareDecision(s);
  assert.match(after.sharedState, /Scoreboard kills: 3/);
  assert.match(after.sharedState, /Movement ineffective for 2\.0s; body stationary/);
  assert.deepEqual(after.eligible.map(c => c.id), before.eligible.map(c => c.id));
  assert.deepEqual(after.eligible.map(c => c.params), before.eligible.map(c => c.params));
});

test("test-only movement measurements never enter model observations, choices or memory", () => {
  const s = observation(), forbidden = () => assert.fail("evaluation evidence leaked to the model");
  for (const key of ["evaluation", "distance", "maxDisplacement", "movingTicks", "attackTicks"]) Object.defineProperty(s, key, { get: forbidden });
  assert.ok(prepareDecision(s).requests.length);
  for (const file of ["agent.js", "decisions.js", "perception.js", "screen.js", "engine.js"]) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), /qev_evaluation|gameplay-report|eval_distance|maxDisplacement/);
  }
  const build = readFileSync(new URL("../scripts/build-engine.mjs", import.meta.url), "utf8");
  assert.match(build, /evaluation \? "build\/engine-evaluation" : "build\/engine"/);
  assert.match(build, /evaluation \? "-Dqev_EVALUATION" : ""/);
});

test("projectiles are visual danger evidence, not invented shootable enemies", () => {
  const s = observation(); s.features = [visible("projectile", 77)]; s.enemies = [];
  const r = prepareDecision(s);
  assert.equal(r.bindings.aim.length, 0); assert.match(r.sharedState, /projectile/);
  assert.ok(r.eligible.some(c => c.id === "fire"));
});

test("empty guns stay in inventory evidence but automatic equipment uses the axe without vetoing attack", () => {
  const s = observation(); s.player.ammo = s.player.shells = 0;
  const r = prepareDecision(s);
  assert.match(r.sharedState, /Owned weapons: axe, shotgun/);
  assert.equal(r.automatic.weapon.name, "axe");
  assert.equal(r.eligible.find(c => c.id === "fire").params.fire, true);
});

test("native input uses ordinary run limits and cannot deadlock fire waiting for a refused switch", () => {
  const c = readFileSync(new URL("../engine/qev_bridge.c", import.meta.url), "utf8");
  assert.match(c, /#define qev_SPEED 400\.0f/); assert.match(c, /#define qev_AIM_TURN 720\.0f/);
  assert.match(c, /if \(impulse\) fire = 0/); assert.doesNotMatch(c, /if \(needs_weapon\) fire = 0/);
  assert.match(c, /int impulse = action_ticks == 0 && needs_weapon/);
  assert.doesNotMatch(c, /sv_maxspeed\.value\s*=/);
});
