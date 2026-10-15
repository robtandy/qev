import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { animationHeader } from "../scripts/animation-data.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "engine/animation-labels.json"), "utf8"));
const compiler = process.env.CC || "cc";
const available = spawnSync(compiler, ["--version"], { encoding: "utf8" }).status === 0;
const temp = mkdtempSync(resolve(tmpdir(), "qev-animation-")), binary = resolve(temp, "animation");
after(() => rmSync(temp, { recursive: true, force: true }));
const fixture = { model: "progs/qev_test.mdl", fnv64: "a430d84680aabd0b", sha256: createHash("sha256").update("hello").digest("hex"),
  bytes: 5, frames: 4, ranges: [[0, 0, "idle"], [1, 1, "death"], [2, 2, "dead"], [3, 3, "downed"]] };
if (available) {
  // The synthetic identity exists only in the test's temporary header, never in an engine build.
  writeFileSync(resolve(temp, "qev_animation_data.h"), animationHeader({ models: [...manifest.models, fixture] }));
  const compiled = spawnSync(compiler, ["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined",
    "-I", resolve(root, "engine"), "-I", temp, resolve(root, "engine/qev_animation.c"), resolve(root, "tests/animation.c"), "-o", binary], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
}
test("native animation classification is bounded, content-specific and distinguishes downed from dead (ASan + UBSan)", { skip: !available && "C compiler required" }, () => {
  const run = spawnSync(binary, [], { encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /PASS/);
});

test("animation labels cover known assets completely without guessing from filenames or frame counts", () => {
  assert.equal(manifest.models.length, 26);
  const header = animationHeader(manifest); assert.doesNotMatch(header, /qev_test/);
  for (const m of manifest.models) {
    assert.ok(m.source); assert.ok(m.sha256); assert.ok(header.includes(`0x${m.fnv64}`));
  }
  const frame = (name, n) => manifest.models.find(m => m.model === `progs/${name}.mdl`).ranges.find(([a, b]) => n >= a && n <= b)?.[2];
  for (const n of [85, 96]) assert.equal(frame("knight", n), "dead");
  for (const n of [76, 84, 86, 95]) assert.equal(frame("knight", n), "death");
  assert.equal(frame("knight", 72), "idle"); // Kneeling/standing is NOT death.
  for (const n of [125, 135]) assert.equal(frame("ogre", n), "dead");
  for (const n of [17, 28]) assert.equal(frame("soldier", n), "dead");
  for (let n = 162; n <= 191; n++) assert.equal(frame("zombie", n), "downed");
  assert.equal(frame("zombie", 192), "idle"); assert.equal(frame("h_zombie", 0), "dead");
  assert.equal(frame("tarbaby", 60), "unknown", "an exploding spawn must not be declared a harmless corpse");
  assert.equal(frame("oldone", 46), "unknown", "do not infer liveness from ambiguous shaking");
});

test("invalid or overlapping animation metadata cannot compile into a build", () => {
  for (const mutate of [m => m.ranges[1][0]--, m => m.ranges[1][0]++, m => m.ranges.pop(),
    m => m.ranges[0][2] = 'dead"; injected', m => m.frames = 0, m => m.bytes = -1,
    m => m.fnv64 = "unknown", m => m.sha256 = "missing", m => m.model = "../bad.mdl"]) {
    const m = structuredClone(fixture); mutate(m); assert.throws(() => animationHeader({ models: [m] }));
  }
  assert.throws(() => animationHeader({ models: [fixture, fixture] }));
});

test("the annotation lookup cannot access entities or mutate game assets/physics", () => {
  const lookup = readFileSync(resolve(root, "engine/qev_animation.c"), "utf8");
  assert.doesNotMatch(lookup, /#include "quakedef|EDICT_NUM|->v\.|SV_Move|cl_entities|nextthink\s*[=();]/);
  const bridge = readFileSync(resolve(root, "engine/qev_bridge.c"), "utf8");
  const renderPose = bridge.slice(bridge.indexOf("void qev_AliasModel"), bridge.indexOf("static const char *entity_kind"));
  assert.doesNotMatch(renderPose, /EDICT_NUM|->v\.|deadflag|health\s*[<>=]|->frame\s*=/);
  assert.match(renderPose, /qev_AnimationModel\(bytes, \(size_t\)length, asset->numframes\)/);
  assert.match(renderPose, /qev_AnimationPose\(animation_assets\[i\]\.labels, entity->frame\)/);
});

// When the separately installed demo is present, audit ALL real MDLs through the
// same native code, including a one-byte mutation. Assets stay in temp/ignored paths.
const demo = resolve(root, "build/demo/librequake-v0.09-beta-lite");
if (available && existsSync(resolve(demo, "pak0.pak")) && existsSync(resolve(demo, "pak1.pak"))) {
  test("every installed pinned demo animation asset matches SHA-256 and native classification; altered bytes abstain", () => {
    const assets = new Map();
    for (const path of ["pak0.pak", "pak1.pak"]) {
      const b = readFileSync(resolve(demo, path)), end = b.readUInt32LE(4) + b.readUInt32LE(8);
      for (let i = b.readUInt32LE(4); i < end; i += 64) {
        const name = b.toString("ascii", i, i + 56).split("\0")[0];
        if (name.endsWith(".mdl")) assets.set(name, b.subarray(b.readUInt32LE(i + 56), b.readUInt32LE(i + 56) + b.readUInt32LE(i + 60)));
      }
    }
    for (const m of manifest.models) {
      const bytes = assets.get(m.model); assert.ok(bytes, m.model);
      assert.equal(bytes.length, m.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), m.sha256);
      const file = resolve(temp, "asset.mdl"); writeFileSync(file, bytes);
      const run = spawnSync(binary, [file], { encoding: "utf8" }); assert.equal(run.status, 0, `${m.model}: ${run.stderr}`);
      assert.deepEqual(run.stdout.trim().split(","), m.ranges.flatMap(([first, last, pose]) => Array(last - first + 1).fill(pose)), m.model);
    }
  });
}
