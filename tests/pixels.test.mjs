import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = process.env.CC || "cc";
const available = spawnSync(compiler, ["--version"], { encoding: "utf8" }).status === 0;
const temp = mkdtempSync(resolve(tmpdir(), "qev-pixels-")), binary = resolve(temp, "pixels");
after(() => rmSync(temp, { recursive: true, force: true }));
if (available) {
  const compiled = spawnSync(compiler, ["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined",
    "-I", resolve(root, "engine"), resolve(root, "engine/qev_pixels.c"), resolve(root, "tests/pixels.c"), "-o", binary], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
}
for (const name of ["painted", "occlusion", "holes", "clipping", "reset", "invalid", "warp", "aim", "scene"]) {
  test(`native visible-pixel reducer: ${name} (ASan + UBSan)`, { skip: available ? false : "A C compiler is required for native reducer checks" }, () => {
    const run = spawnSync(binary, [name], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /PASS/);
  });
}

test("the pixel reducer has no world/depth dependency and the only controller has no hidden-world probes", () => {
  const reducer = readFileSync(resolve(root, "engine/qev_pixels.c"), "utf8");
  assert.doesNotMatch(reducer, /quakedef|SV_Move|d_pzbuffer|zspantable|viewangles|EDICT_NUM/);
  const bridge = readFileSync(resolve(root, "engine/qev_bridge.c"), "utf8");
  assert.doesNotMatch(bridge, /qev_assistance|qev_probe|SV_Move|SV_PointContents|has_los|valid_target|target_generation|bearingRight/);
  assert.match(bridge, /Chosen contact is no longer visible/);
  assert.match(bridge, /o->at_aim/);
  const pixelsJSON = bridge.slice(bridge.indexOf("static void screen_objects_json"), bridge.indexOf("EMSCRIPTEN_KEEPALIVE const char *qev_snapshot"));
  assert.doesNotMatch(pixelsJSON, /center\(|visible\(|length3|SV_Move|viewangles|d_pzbuffer|bearingRight|\\"distance\\"/);
  const soundHook = bridge.slice(bridge.indexOf("void qev_AudibleSound"), bridge.indexOf("static void clear_action"));
  assert.doesNotMatch(soundHook, /origin|EDICT_NUM|entnum|viewangles|SV_|channel_t/);
  assert.match(soundHook, /left < 48 && right < 48/);
});
