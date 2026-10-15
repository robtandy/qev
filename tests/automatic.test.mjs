import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { automaticPlan } from "../src/automatic.js";
import { prepareDecision, resolveSelection } from "../src/decisions.js";
import { Agent } from "../src/agent.js";
import { decisionOutcome } from "../src/decision-cards.js";
import { observation, visible, advance } from "./observations.mjs";
import { decisionReplies } from "./replies.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = process.env.CC || "cc", temp = mkdtempSync(resolve(tmpdir(), "qev-nearest-"));
const available = spawnSync(compiler, ["--version"], { encoding: "utf8" }).status === 0;
after(() => rmSync(temp, { recursive: true, force: true }));
test("native nearest-visible distance selection (ASan + UBSan)", { skip: !available && "C compiler required" }, () => {
  const binary = resolve(temp, "nearest");
  const compiled = spawnSync(compiler, ["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined",
    "-I", resolve(root, "engine"), resolve(root, "engine/qev_nearest.c"), resolve(root, "tests/nearest.c"), "-lm", "-o", binary], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
  const run = spawnSync(binary, [], { encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /PASS nearest/);
});

test("native distance is gated by final visible pixels and pose eligibility; only markers are serialized", () => {
  const source = readFileSync(resolve(root, "engine/qev_bridge.c"), "utf8");
  const start = source.indexOf("qev_nearest_t nearest[2]"), end = source.indexOf("view_nearest[0] =", start);
  const selector = source.slice(start, end);
  assert.match(selector, /!v->objects\[i\]\.count\) \{ view_refs\[i\] = 0; continue; \}/);
  assert.ok(selector.indexOf("qev_FallenAnimation") < selector.indexOf("entity_t *entity"));
  assert.ok(selector.indexOf("continue;") < selector.indexOf("entity->origin"));
  assert.match(selector, /qev_NearestConsider.*r_refdef.vieworg, center/);
  assert.doesNotMatch(selector, /EDICT_NUM|sv\.edicts|->v\.|health|deadflag|SV_Move|Mod_PointInLeaf/);
  const json = source.slice(source.indexOf("static void screen_objects_json"), source.indexOf("static void screen_json"));
  assert.match(json, /i != nearest/); assert.match(json, /selected\[pos\] == nearest/);
  assert.doesNotMatch(json, /\.squared|entity->origin|vieworg|distance|coordinates/);
});

test("one action request is invariant to enemy, pickup and weapon counts", () => {
  for (const count of [0, 1, 2, 6]) {
    const s = observation(); s.enemies = Array.from({ length: count }, (_, i) => visible("monster_army", 10 + i, undefined, { nearest: i === count - 1 }));
    s.pickups = Array.from({ length: count }, (_, i) => visible("health", 30 + i, undefined, { nearest: i === count - 1 }));
    const r = prepareDecision(s);
    assert.equal(r.requests.length, 1); assert.deepEqual(Object.keys(r.requests[0].questions), ["action"]);
    assert.equal(Object.keys(r.requests[0].questions.action.criteria).length, r.eligible.length);
  }
});

test("automatic targets use the native marker, not first row, apparent size, health need or crosshair", () => {
  const s = observation(); s.enemies[0].nearest = false; s.pickups[0].nearest = false; s.player.health = 250;
  const tiny = { nearest: true, screen: { bounds: [0.1, 0.1, 0.11, 0.12], pixels: 2, aimOverlap: false, clipped: false, sameKindCount: 1 } };
  s.enemies.push(visible("monster_dog", 99, undefined, tiny)); s.pickups.push(visible("mega_health", 88, undefined, tiny));
  const plan = automaticPlan(s); assert.equal(plan.aim.ref, 99); assert.equal(plan.item.ref, 88);
  for (const [action, expected] of [["engage", 99], ["approach", 88]]) {
    const r = prepareDecision(s); r.responses = decisionReplies(r, { action });
    assert.equal(resolveSelection(r, { random: () => 0.5 }).params.ref, expected);
  }
});

for (const mutate of [s => s.enemies[0].visible = false, s => s.enemies[0].pose = "dead", s => s.enemies[0].pose = "death",
  s => s.screen.tick--, s => s.screen.available = false, s => s.enemies[0].ref = null]) test("a marked hidden, stale, invalid or fallen object cannot be selected", () => {
  const s = observation(); mutate(s); assert.equal(automaticPlan(s).aim, null);
});

test("model requests and memories cannot read or expose coordinates/ranges used only by native visible selection", () => {
  const s = observation(), forbidden = () => assert.fail("privileged field read");
  for (const object of [s.player, ...s.enemies, ...s.pickups])
    for (const name of ["position", "origin", "distance", "squared", "coordinates", "range"]) Object.defineProperty(object, name, { get: forbidden });
  const r = prepareDecision(s); assert.equal(r.automatic.aim.ref, 10);
  assert.doesNotMatch(JSON.stringify(r.requests), /"nearest"|"ref"|coordinates|distance [0-9]|"origin"|"squared"/);
});

test("nearest markers are strict booleans, never truthy strings/numbers or fabricated first-row defaults", () => {
  for (const value of [false, undefined, null, 1, "true"]) {
    const s = observation(); s.enemies[0].nearest = value;
    const r = prepareDecision(s); r.responses = decisionReplies(r, { action: "engage" });
    assert.equal(r.automatic.aim, null); assert.match(r.automatic.errors.aim, /nearest-visible marker/);
    assert.throws(() => resolveSelection(r), /Automatic aim unavailable/);
  }
});

function liveFixture() {
  const s = observation(), calls = []; let draws = 0;
  s.enemies.push(visible("monster_ogre", 71));
  const engine = { snapshot: () => structuredClone(s), pause() { s.paused = true; },
    startAuto() { s.paused = false; s.controlSession++; return s.controlSession; },
    applyLive(params) { calls.push(structuredClone(params)); s.actionSerial++; s.actionTicksLeft = params.ticks; return true; } };
  let agent;
  const model = { decideMany: async () => decisionReplies(agent.current, { action: "engage" }) };
  agent = new Agent({ engine, getModel: () => model, random: () => { draws++; return 0.5; } });
  agent.startLive(); return { agent, s, calls, get draws() { return draws; } };
}

test("live application refreshes nearest target and loaded weapon without resampling or altering the tactic", async () => {
  const f = liveFixture(), r = await f.agent.score({ realtime: true });
  assert.equal(r.selected.params.ref, 10); assert.equal(r.selected.params.weapon, 2);
  const scored = structuredClone(r.selectedAtScore), raw = structuredClone(r.responses);
  advance(f.s, 6); f.s.enemies[0].nearest = false; f.s.enemies[1].nearest = true;
  f.s.player.weapons.push({ id: 3, name: "double shotgun" }); f.s.player.shells = 3;
  assert.equal(f.agent.applyLive(), true); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].ref, 71); assert.equal(f.calls[0].weapon, 3); assert.equal(r.selected.id, "engage");
  assert.equal(f.draws, 1); assert.deepEqual(r.selectedAtScore, scored); assert.deepEqual(r.responses, raw);
  assert.equal(decisionOutcome(r).automaticAtScore.aim.ref, 10); assert.equal(decisionOutcome(r).automaticAtApply.aim.ref, 71);
  f.s.enemies[1].nearest = false; f.s.enemies[0].nearest = true;
  f.agent.observeObservation(f.s); assert.equal(r.selected.params.ref, 71, "no mid-lease nearest-target replacement");
});

test("no remaining visible target rejects live application without a substitute or redraw", async () => {
  const f = liveFixture(), r = await f.agent.score({ realtime: true }); advance(f.s, 6); f.s.enemies = [];
  assert.equal(f.agent.applyLive(), false); assert.equal(r.status, "rejected"); assert.equal(f.calls.length, 0); assert.equal(f.draws, 1);
  assert.equal(r.selectedAtScore.params.ref, 10); assert.equal(r.automaticAtApply.aim, null);
});
