import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../src/agent.js";
import { observation, advance } from "./observations.mjs";
import { decisionReplies } from "./replies.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = process.env.CC || "cc";
const available = spawnSync(compiler, ["--version"], { encoding: "utf8" }).status === 0;
const temp = mkdtempSync(resolve(tmpdir(), "qev-recenter-")), binary = resolve(temp, "recenter");
after(() => rmSync(temp, { recursive: true, force: true }));
test("native pitch recovery is bounded, reaches level and yields to new targets/explicit looks/Stop (ASan + UBSan)", { skip: !available && "C compiler required" }, () => {
  const compiled = spawnSync(compiler, ["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined",
    "-I", resolve(root, "engine"), resolve(root, "engine/qev_recenter.c"), resolve(root, "tests/recenter.c"), "-lm", "-o", binary], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
  const run = spawnSync(binary, [], { encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /PASS/);
});

test("pitch recovery has no target/entity/route access and cannot add movement, yaw, attacks or world frames", () => {
  const helper = readFileSync(resolve(root, "engine/qev_recenter.c"), "utf8");
  assert.doesNotMatch(helper, /quakedef|EDICT|origin|contact\(|SV_|Host_Frame|forwardmove|sidemove|yaw|qev_Buttons/);
  const bridge = readFileSync(resolve(root, "engine/qev_bridge.c"), "utf8");
  assert.match(bridge, /cl.viewangles\[PITCH\] = qev_RecenterStep/);
  assert.match(bridge, /if \(selected_ref \|\| input_pitch_rate != 0\) qev_RecenterRelease/);
  assert.match(bridge, /else if \(input_pitch_rate != 0\) \{\s*qev_RecenterAimed/);
  assert.match(bridge, /view_recovery.active && !selected_ref && input_pitch_rate == 0/);
  assert.match(bridge, /qev_RecenterCommand\(&view_recovery, ref != 0, pitch_rate != 0/);
  assert.match(bridge, /!owned \|\| player\(\)->v.health <= 0 \|\| cl.intermission \|\| \(paused && !remaining\)/);
  assert.match(bridge, /qev_RecenterReset\(&view_recovery\)/);
});

test("camera cleanup counts observed ticks independently of the action lease and does not fabricate outcomes", async () => {
  const state = observation(); state.viewRecovery = { active: false, level: false, ticks: 7 };
  const engine = { snapshot: () => structuredClone(state), pause() {}, async act(p) {
    advance(state, p.ticks); state.actionTicks = p.ticks; state.viewRecovery = { active: false, level: true, ticks: 19 };
    return structuredClone(state);
  } };
  const agent = new Agent({ engine, getModel: () => model });
  const model = { decideMany: async () => decisionReplies(agent.current, { action: "forward" }) };
  const r = await agent.score(); await agent.step();
  assert.equal(r.execution.ticksApplied, 12); assert.equal(r.execution.viewRecoveryTicks, 12);
  assert.equal(r.after.tick - r.before.tick, 12);
  const live = { mode: "realtime", actionSerial: 10, selected: r.selected, appliedAt: { epoch: state.epoch, tick: 40, viewRecovery: { ticks: 19 } } };
  agent.active = live;
  agent.finishLive({ epoch: state.epoch, tick: 120, actionSerial: 10, actionTicks: 45, actionTicksLeft: 0, viewRecovery: { ticks: 43 } }, "ended");
  assert.equal(live.execution.ticksApplied, 45); assert.equal(live.execution.viewRecoveryTicks, 24);
  assert.equal(live.execution.observedEndTick, 120);
  agent.active = { ...live }; const changed = agent.active;
  agent.finishLive({ epoch: state.epoch + 1, tick: 0, actionSerial: 10, actionTicks: 45, actionTicksLeft: 0, viewRecovery: { ticks: 0 } }, "world changed");
  assert.equal(changed.execution.viewRecoveryTicks, null);
});
