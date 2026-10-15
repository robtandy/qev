import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/engine.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = process.env.CC || "cc", temp = mkdtempSync(resolve(tmpdir(), "qev-present-"));
const available = spawnSync(compiler, ["--version"], { encoding: "utf8" }).status === 0;
after(() => rmSync(temp, { recursive: true, force: true }));
test("native presentation batching preserves every frame and flushes early exits (ASan + UBSan)", { skip: !available && "C compiler required" }, () => {
  const binary = resolve(temp, "present");
  const c = spawnSync(compiler, ["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined",
    "-I", resolve(root, "engine"), resolve(root, "engine/qev_present.c"), resolve(root, "tests/present.c"), "-lm", "-o", binary], { encoding: "utf8" });
  assert.equal(c.status, 0, c.stderr);
  const run = spawnSync(binary, [], { encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /PASS presentation/);
});

test("only SDL presentation is deferred; physics, renderer attribution, input, clocks and normal guard limits remain", () => {
  const helper = readFileSync(resolve(root, "engine/qev_present.c"), "utf8"), bridge = readFileSync(resolve(root, "engine/qev_bridge.c"), "utf8");
  assert.doesNotMatch(helper, /quakedef|EDICT|origin|Host_Frame\(|R_RenderView\(|qev_ApplyInput\(|rand\(/);
  const loop = bridge.slice(bridge.indexOf("void qev_MainLoop(void)"));
  assert.match(loop, /qev_PresentBegin\(&presentation, accumulator >= 2 \* qev_DT\)/);
  assert.match(loop, /while \(accumulator >= qev_DT && n\+\+ < 6\)/);
  assert.match(loop, /Host_Frame\(qev_DT\)/); assert.match(loop, /tick\+\+/);
  assert.ok(loop.indexOf("qev_PresentFlush") > loop.lastIndexOf("break;"), "early exits also reach flush");
  assert.match(loop, /if \(qev_PresentFlush\(&presentation\)\) qev_FlushVideo\(\)/);
  assert.match(bridge, /#define qev_DT \(1.0 \/ 60.0\)/); assert.match(bridge, /#define qev_MAX_AGE 60/);
  const patch = readFileSync(resolve(root, "engine/qwasm.patch"), "utf8");
  const video = patch.slice(patch.indexOf("diff --git a/WinQuake/vid_sdl.c"));
  assert.match(video, /qev_DeferVideo\(\).*return/);
  assert.match(video, /force_entire_redraw = true;\n\+    VID_Update\(NULL\)/);
  assert.doesNotMatch(video, /Host_Frame|qev_DT|qev_Pixels|view_angles|qev_ApplyInput/);
  const snapshot = bridge.slice(bridge.indexOf("EMSCRIPTEN_KEEPALIVE const char *qev_snapshot"), bridge.indexOf("#ifdef qev_EVALUATION", bridge.indexOf("EMSCRIPTEN_KEEPALIVE const char *qev_snapshot")));
  assert.doesNotMatch(snapshot, /qev_diagnostics|presentation\./);
});

test("engine timing inspection is passive and separate from gameplay observations", () => {
  const data = { version: 1, scope: "engine-lifetime", hostFrames: 120, presents: 60, deferred: 120, speed: 1 };
  const engine = new Engine({ _qev_diagnostics: () => 42, UTF8ToString: ptr => { assert.equal(ptr, 42); return JSON.stringify(data); },
    _qev_snapshot() { assert.fail("do not rebuild or alter the observation"); }, _qev_step_frame() { assert.fail("do not add frames"); } });
  assert.deepEqual(engine.diagnostics(), data); assert.equal(new Engine({}).diagnostics(), null);
  const fault = new Error("engine stopped"); engine.getFault = () => fault;
  assert.throws(() => engine.diagnostics(), e => e === fault);
});
