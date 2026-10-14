// Rebuild the explicitly synthetic protocol example. No engine/model/asset access.
import { writeFile } from "node:fs/promises";
import { prepareDecision, resolveSelection } from "../src/decisions.js";
const object = (kind, ref, bounds, pixels) => ({ kind, ref, visible: true, pose: "unknown",
  screen: { bounds, pixels, aimOverlap: false, clipped: false, sameKindCount: 1 } });
const observation = { version: 4, controlMode: "player-observable", ready: true, alive: true, completed: false,
  paused: true, owned: true, epoch: 1, tick: 42,
  player: { health: 28, armor: 0, ammo: 8, weapon: "shotgun", shells: 8, nails: 0, rockets: 0, cells: 0,
    silverKey: false, goldKey: false, grounded: true, inWater: false,
    weapons: [{ id: 1, name: "axe" }, { id: 2, name: "shotgun" }], powerups: {} },
  screen: { source: "renderer-visible-pixels", available: true, frame: 42, tick: 42, viewport: [0,0,640,432], distorted: false },
  enemies: [object("monster_army", 10, [0.60,0.40,0.68,0.56], 2000)],
  pickups: [object("health", 20, [0.22,0.55,0.29,0.64], 600)], features: [],
  scene: Array.from({ length: 9 }, (_, i) => i === 8 ? [15000,0,0,0,0,0,11000,0] : i >= 6 ? [26000,0,0,0,0,0,0,0] : [0,26000,0,0,0,0,0,0]),
  audio: { source: "mixed-sound-captions", available: true, events: [{ kind: "weapon", direction: "right", loudness: "clear", ageTicks: 8 }] },
};
const r = prepareDecision(observation), choices = { action: "back-fire", aim: "e1", item: "p1", weapon: "w2" };
r.responses = r.requests.map(request => ({ model: "synthetic-example-no-inference", answers: Object.fromEntries(Object.entries(request.questions).map(([name, q]) => {
  const keys = Object.keys(q.criteria), choice = name === "action" ? r.eligible.find(c => c.id === choices.action).optionId : choices[name];
  return [name, { type: "choice", choice, probabilities: Object.fromEntries(keys.map(key => [key, keys.length === 1 ? 1 : key === choice ? 0.6 : 0.4 / (keys.length - 1)])) }];
})) }));
// Fixed illustrative draws, not real inference/randomness: action deliberately
// samples Engage instead of SDK argmax back-fire; equipment samples the shotgun.
const illustrativeDraws = [0.2, 0.5, 0.7];
const selected = resolveSelection(r, { random: () => illustrativeDraws.shift() });
await writeFile(new URL("../examples/combat-decision.json", import.meta.url), JSON.stringify({
  synthetic: true, notice: "Hand-authored observation, probabilities and sampling draws. Not captured gameplay, real model inference or an executed command. Refs are illustrative.",
  controlMode: r.controlMode, observationPolicy: r.observationPolicy, controller: r.controller, observation,
  requests: r.requests, responses: r.responses, sampling: r.sampling, resolvedCommandExample: { id: selected.id, optionId: selected.optionId, label: selected.label, selection: selected.selection, weaponSelection: selected.weaponSelection, params: selected.params },
  notes: ["All tactics are offered without geometry probes, resource/health filtering or a tactical shortlist.",
    "Separate choice questions share the same state in one batch. The chosen tactic's target and the concurrent weapon choice are used. Keeping the shotgun does not consume a separate action.",
    "Full distributions are sampled once, in offer order. Each used head records its draw and interval; the original SDK argmax and probabilities remain untouched. No retry or tactical substitution.",
    "Here the illustrative action draw selects Engage rather than the SDK's top back-fire; the aim and equipment draws choose e1 and shotgun.",
    "Visible lava coverage is not a predicted movement outcome. There is no hit, safety or collection guarantee.",
    "This file contains no native execution outcome or model-performance claim."],
}, null, 2) + "\n");
