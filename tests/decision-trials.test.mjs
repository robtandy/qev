import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTrial } from "../scripts/compare-decisions.mjs";

function record(id = "turn-left") {
  const player = {};
  Object.defineProperty(player, "position", { get() { assert.fail("Trial summaries must not query GPS"); } });
  return { status: "replaced", ms: 100, selectedIndex: 0, selected: { id },
    appliedAt: { epoch: 1, player }, after: { epoch: 1, player }, execution: { ticksApplied: 12 } };
}
function report(records) {
  return { map: "test", format: "choice", wallMs: 30000, start: { tick: 1 },
    end: { tick: 1801, alive: true, completed: false, player: { health: 100, ammo: 25 } }, records };
}

test("trial summaries count requested look inputs without claiming stationary bodies, distance or map coverage", () => {
  const summary = summarizeTrial(report([record(), record(), record("forward"), record()]));
  assert.equal(summary.lookActions, 3); assert.equal(summary.lookInputTicks, 36); assert.equal(summary.longestLookSequence, 2);
  assert.equal(summary.rememberedCells, undefined); assert.equal(summary.distanceMoved, undefined);
  assert.equal(summary.longestScanStreak, undefined); assert.equal(summary.simulationTicks, 1800);
});

test("deadline cancellation and zero fresh baseline actions are reported honestly", () => {
  const summary = summarizeTrial(report([{ status: "discarded", ms: 1600 }]));
  assert.equal(summary.discarded, 1); assert.equal(summary.applied, 0);
  assert.equal(summary.stale, undefined); assert.equal(summary.completed, false);
});
