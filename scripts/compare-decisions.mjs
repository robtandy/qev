// Optional --compare diagnostic: identical saved offers for paired scoring;
// independent live episodes, NOT matched replay or a survival-rate benchmark.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRIMARY_OBJECTIVE } from "../src/objective.js";

const median = values => { const sorted = values.toSorted((a, b) => a-b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const round = n => n === null ? null : Math.round(n * 10) / 10;
export function summarizeTrial(report) {
  const applied = report.records.filter(r => r.appliedAt);
  const choice = r => r.selected || r.eligible[r.selectedIndex];
  const looking = r => ["turn-left", "turn-right", "look-up", "look-down"].includes(choice(r)?.id);
  const looks = applied.filter(looking);
  let current = 0, longestLookSequence = 0;
  for (const r of applied) { current = looking(r) ? current + 1 : 0; longestLookSequence = Math.max(current, longestLookSequence); }
  return { map: report.map, format: report.format, wallMs: round(report.wallMs), alive: report.end.alive, completed: report.end.completed,
    health: report.end.player.health, ammo: report.end.player.ammo,
    simulationTicks: report.end.tick - report.start.tick, decisions: report.records.length, applied: applied.length,
    discarded: report.records.filter(r => r.status === "discarded").length,
    medianInferenceMs: round(median(report.records.filter(r => r.ms !== null).map(r => r.ms))),
    lookActions: looks.length, lookInputTicks: looks.reduce((n, r) => n + (r.execution?.ticksApplied || 0), 0), longestLookSequence,
    tokenLimitWarnings: report.records.filter(r => r.warnings?.length).length };
}

// Serialized into the real browser. Do not close over Node variables.
async function runTrial(map, format, durationMs) {
  const { Agent } = await import("/src/agent.js");
  qev.pause(); qev.agent.invalidate();
  const engine = qev.engine; await engine.loadMap(map); engine.speed(1);
  const retryDeaths = qev.respawner.enabled; qev.respawner.enabled = false;
  const records = new Map();
  const agent = new Agent({ engine, getModel: () => qev.model, decisionFormat: format,
    onChange: () => { if (agent.current) records.set(agent.current.id, agent.current); } });
  agent.observeLive(engine.snapshot());
  const start = engine.snapshot(), started = performance.now(); agent.startLive();
  const observer = setInterval(() => agent.observeLive(engine.snapshot()), 100);
  const deadline = setTimeout(() => agent.pause(), durationMs);
  let error = null;
  try {
    while (performance.now() - started < durationMs && agent.liveSession !== null) {
      agent.observeLive(engine.snapshot()); const now = engine.snapshot();
      if (!now.ready || !now.alive || now.completed || now.paused || now.controlSession !== agent.liveSession) break;
      const began = performance.now(), record = await agent.score({ realtime: true });
      if (record && performance.now() - started < durationMs && agent.liveSession !== null) agent.applyLive();
      await new Promise(r => setTimeout(r, Math.max(0, 120 - (performance.now() - began))));
    }
  } catch (failure) { error = failure.message; }
  finally { clearTimeout(deadline); clearInterval(observer); agent.pause(); qev.respawner.enabled = retryDeaths; }
  return { map, format, durationMs, wallMs: performance.now() - started, start, end: engine.snapshot(),
    memory: agent.observations.describe(engine.snapshot()), records: [...records.values()], error };
}
async function scorePairs(samples) {
  const { requestsFor, resolveSelection } = await import("/src/decisions.js");
  qev.pause(); const results = [];
  for (const [index, sample] of samples.entries()) {
    const requests = Object.fromEntries(["choice", "noul"].map(format => [format, requestsFor(sample.eligible, sample.sharedState, format, sample.grounding)]));
    const runs = [];
    for (let repeat = 0; repeat < 2; repeat++) for (const format of ((index + repeat) % 2 ? ["choice", "noul"] : ["noul", "choice"])) {
      const started = performance.now(), responses = await qev.model.decideMany(requests[format]), ms = performance.now() - started;
      const record = { ...sample, requests: requests[format], responses, decisionFormat: format, sampling: null };
      const selected = resolveSelection(record), ranking = record.ranking;
      runs.push({ format, repeat, ms, tokens: responses.reduce((n, r) => n + r.usage.input_tokens, 0),
        largestInput: Math.max(...responses.map(r => r.usage.input_tokens)), selected: selected.label,
        sampling: record.sampling, resolved: selected, ranking, responses });
    }
    results.push({ id: sample.id, before: sample.before, eligible: sample.eligible, bindings: sample.bindings, requests, runs });
  }
  return results;
}
async function promptStressCases() {
  const { prepareDecision } = await import("/src/decisions.js");
  const object = (kind, ref) => ({ kind, ref, visible: true, pose: "unknown",
    screen: { bounds: [0.4, 0.4, 0.6, 0.65], pixels: 300, aimOverlap: true, clipped: false, sameKindCount: 1 } });
  const before = { ready: true, alive: true, completed: false, epoch: 1, tick: 100,
    screen: { source: "renderer-visible-pixels", available: true, frame: 100, tick: 100, viewport: [0,0,640,432], distorted: false },
    player: { health: 25, armor: 100, ammo: 100, weapon: "super nailgun", shells: 0, nails: 100, rockets: 0, cells: 0,
      silverKey: false, goldKey: false, grounded: true, weapons: [{ id: 1, name: "axe" }, { id: 5, name: "super nailgun" }] },
    enemies: [object("monster_shambler", 10), object("monster_shalrath", 11), object("monster_hell_knight", 12)],
    pickups: [object("silver_key", 20), object("gold_key", 21), object("mega_health", 22)], features: [] };
  return [false, true].map(realtime => {
    const p = prepareDecision(before, null, { realtime });
    return { id: `synthetic-token-budget-${realtime ? "live" : "inspection"}`, before, ...p };
  });
}
export async function compareDecisions({ evaluate, root }) {
  const stress = await evaluate(`(${promptStressCases.toString()})()`);
  const stressResults = await evaluate(`(${scorePairs.toString()})(${JSON.stringify(stress)})`);
  await writeFile(resolve(root, "build/choice-token-budget.json"), JSON.stringify(stressResults, null, 2));
  const reports = [], samples = [];
  for (const [index, map] of ["lq_e0m1", "lq_e0m2"].entries()) for (const format of (index % 2 ? ["choice", "noul"] : ["noul", "choice"])) {
    const report = await evaluate(`(${runTrial.toString()})(${JSON.stringify(map)},${JSON.stringify(format)},30000)`);
    reports.push(report);
    await writeFile(resolve(root, `build/comparison-${map}-${format}.json`), JSON.stringify(report, null, 2));
    // A larger baseline may produce zero fresh replies. Report that outcome;
    // never weaken the time/ownership guards or fabricate executed actions.
    console.log("Independent format episode:", { ...summarizeTrial(report), error: report.error });
    const usable = report.records.filter(r => r.before.player.grounded && r.eligible.length > 1);
    for (const fraction of [0, 0.5, 0.95]) {
      const record = usable[Math.floor((usable.length - 1) * fraction)], id = `${map}-${format}-${record?.id}`;
      if (record && !samples.some(s => s.id === id)) samples.push({ id, before: record.before, eligible: record.eligible,
        bindings: record.bindings, grounding: record.grounding, sharedState: record.sharedState });
    }
  }
  const paired = (await evaluate(`(${scorePairs.toString()})(${JSON.stringify(samples)})`)).concat(stressResults);
  const actual = paired.filter(r => !r.id.startsWith("synthetic-"));
  const inference = Object.fromEntries(["choice", "noul"].map(format => {
    const runs = actual.flatMap(s => s.runs.filter(r => r.format === format));
    return [format, { runs: runs.length, medianMs: round(median(runs.map(r => r.ms))), medianTokens: median(runs.map(r => r.tokens)),
      largestQuestion: runs.length ? Math.max(...runs.map(r => r.largestInput)) : null, tokenLimitHits: runs.filter(r => r.largestInput >= 512).length }];
  }));
  const summary = { objective: PRIMARY_OBJECTIVE, controlMode: "player-observable", model: await evaluate("qev.model.info"), liveTrialMs: 30000,
    pairedStates: actual.length, matchingChoices: actual.filter(s => s.runs.find(r => r.format === "choice").selected === s.runs.find(r => r.format === "noul").selected).length,
    inference, trials: reports.map(summarizeTrial), caveats: [
      "Identical saved observations and complete offered tactic/target pools for paired inference. One call with multiple explicit choice heads vs per-tactic noul ratings plus the same binding heads; not an isolated question-type ablation.",
      "Live trials are separate non-deterministic episodes, not identical replays or a survival/completion-rate benchmark. Larger batches can expire before application.",
      "Choice heads are sampled independently, with draws retained; matching choices does not compare argmax policies. The noul tactic remains highest-rating, not a categorical probability sample.",
      "Look-action counts describe requested inputs, not stationary bodies or explored distance. No GPS/visited-area metrics are collected.",
      "Discarded includes intentional deadline cancellation. Synthetic fixtures are only token-budget checks. Each usage count is for one question, not an aggregate." ] };
  await writeFile(resolve(root, "build/decision-comparison.json"), JSON.stringify({ summary, paired }, null, 2));
  console.log("Paired format diagnostic:", JSON.stringify(summary, null, 2)); return summary;
}
