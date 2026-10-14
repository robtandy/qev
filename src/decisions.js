import { PRIMARY_OBJECTIVE, DEFAULT_PRIORITY_ORDER, validatePriorityOrder, objectivesFor, goalPrompt } from "./objective.js";
import { CONTROL_MODE, OBSERVATION_POLICY, CONTROLLER_POLICY, OFFER_POLICY } from "./control.js";
import { screenCues, fallenEnemy } from "./screen.js";
import { perception, readable, viewText, targetText, sceneText, poseText } from "./perception.js";
import { weaponReach, weaponOption, weaponInventory, WEAPON_GUIDANCE } from "./weapons.js";
import { SAMPLING_METHOD, sampleDistribution } from "./sampling.js";

export const ACTION_TICKS = 12;
export const LIVE_TICKS = 45;
export const MAX_DECISION_AGE_TICKS = 60;
export const MAX_DECISION_AGE_MS = 1500;
export const TICK_HZ = 60;
export const DEFAULT_DECISION_FORMAT = "choice";
export function validateDecisionFormat(format) {
  if (format !== "choice" && format !== "noul") throw new Error(`Unsupported decision format: ${format}`);
  return format;
}
// Kevala includes option KEYS in the encoded text. Keep internal tactic names
// out of those keys so recent-action IDs do not become duplicated answer hints.
const optionId = candidate => candidate.optionId ?? candidate.id;
// Explicit diagnostic comparison, never an automatic fallback.
export const NOUL_BASELINE_QUESTION = {
  favorable: { type: "noul", instructions: `Does this action help the player ${PRIMARY_OBJECTIVE} according to the listed priorities, highest first?`,
    criteria: { true: "advances a higher-priority goal without needlessly sacrificing it for a lower-priority goal",
      false: "ignores higher-priority needs or pursues a lower-priority goal at their expense" } },
};

export function situation(observation, memory = null, { priorityOrder = DEFAULT_PRIORITY_ORDER, visual = screenCues(observation), realtime = false, heldAction = null } = {}) {
  if (observation.completed) return "Level complete; the game confirmed intermission.";
  if (!observation.ready || !observation.player) return "No active player observation.";
  const p = observation.player, seen = perception(observation, visual);
  const text = [goalPrompt(priorityOrder),
    `HUD: health ${p.health}, armor ${p.armor}, held ${p.weapon} (${weaponReach(p.weapon)}), ${p.weapon === "axe" ? "no ammo needed" : `ammo ${p.ammo}`}; shells/nails/rockets/cells ${p.shells ?? 0}/${p.nails ?? 0}/${p.rockets ?? 0}/${p.cells ?? 0}; keys ${[p.silverKey && "silver", p.goldKey && "gold"].filter(Boolean).join("+") || "none"}; ${p.grounded ? "grounded" : "airborne"}${p.inWater ? "; water" : ""}.`,
    ...(["quad", "invulnerable", "invisible", "suit"].some(key => p.powerups?.[key] === true) ? [`Powerups: ${["quad", "invulnerable", "invisible", "suit"].filter(key => p.powerups?.[key] === true).join(",")}.`] : []),
    `${weaponInventory(seen.weapons)} ${WEAPON_GUIDANCE}`,
    seen.available ? `Visible: ${viewText(seen) || "no labelled objects"}.` : "View unavailable; unseen areas unknown.",
    ...(seen.omitted ? [`${seen.omitted} additional visible objects omitted by sensor cap.`] : []),
    ...(sceneText(seen) ? [sceneText(seen)] : []),
    ...(seen.sounds.length ? [`Heard: ${seen.sounds.slice(0, 3).map(e => `${e.kind.replaceAll("_", " ")} ${e.direction} ${e.loudness}${e.ageTicks >= 30 ? ` ${Math.ceil(e.ageTicks / 60)}s ago` : ""}`).join("; ")}.`] : []),
  ];
  if (Number.isSafeInteger(p.kills)) text.push(`Scoreboard kills: ${p.kills}.`);
  if (p.noMovementTicks >= 6) text.push(`Movement ineffective for ${(p.noMovementTicks / TICK_HZ).toFixed(1)}s; body stationary.`);
  if (memory?.pastSightings?.length) text.push(`Previously seen, NOT tracked: ${memory.pastSightings.slice(0, 2).map(e => `${readable(e.kind)}${poseText(e) ? ` ${poseText(e)}` : ""} old-view ${e.side} ${Math.ceil(e.ageTicks / 60)}s ago`).join("; ")}.`);
  const last = memory?.actions?.at(-1);
  if (last) text.push(`Since ${last.actionId || last.action}: health ${last.healthChange >= 0 ? "+" : ""}${last.healthChange}${last.weaponChanged ? "; weapon changed" : `, ammo ${last.ammoChange >= 0 ? "+" : ""}${last.ammoChange}`}${last.weaponEquipped === false ? `; requested ${last.weaponRequested} not equipped` : ""}${last.killsChange > 0 ? `; scoreboard kills +${last.killsChange}` : ""}.${memory.repeated >= 2 ? ` View repeats ${memory.repeated}x (not location).` : ""}`);
  text.push(`${realtime ? `Live, holding ${heldAction || "nothing"}` : "Stopped"}; max ${realtime ? 750 : 200}ms. Unseen unknown; size not depth; crosshair not melee contact.`);
  return text.join("\n");
}

/** No probes, tactical ranking, ammo/survival filters or remembered-route vetoes. */
export function prepareDecision(observation, memory = null, options = {}) {
  const decisionFormat = validateDecisionFormat(options.decisionFormat ?? DEFAULT_DECISION_FORMAT);
  const priorityOrder = validatePriorityOrder(options.priorityOrder === undefined ? DEFAULT_PRIORITY_ORDER : options.priorityOrder);
  const visual = options.visual ?? screenCues(observation), seen = perception(observation, visual);
  const bindings = {
    aim: seen.contacts.filter(e => e.ref !== null && e.group === "enemy" && !fallenEnemy(e)),
    item: seen.contacts.filter(e => e.ref !== null && e.group === "pickup"),
    weapon: seen.weapons.length > 1 ? seen.weapons.map(w => ({ ...w, id: `w${w.id}`, weapon: w.id })) : [],
  };
  const context = observation.ready && observation.alive && !observation.completed
    ? situation(observation, memory, { ...options, priorityOrder, visual }) : "";
  const all = [];
  function add(id, label, fields = {}, binding = null) {
    const params = { epoch: observation.epoch, tick: observation.tick, ref: binding ? null : 0,
      forward: 0, side: 0, up: 0, yawRate: 0, pitchRate: 0, fire: false, jump: false,
      weapon: bindings.weapon.length ? null : 0, ticks: options.realtime ? LIVE_TICKS : ACTION_TICKS, ...fields };
    all.push({ id, optionId: `a${all.length}`, label, choiceText: label, binding, params, allowed: true, reason: null,
      state: `${context}\nCandidate: ${label}.` });
  }
  if (observation.ready && observation.alive && !observation.completed) {
    add("forward", "Run forward", { forward: 1 }); add("back", "Back up", { forward: -1 });
    add("left", "Strafe left", { side: -1 }); add("right", "Strafe right", { side: 1 });
    add("turn-left", "Look left", { yawRate: 90 }); add("turn-right", "Look right", { yawRate: -90 });
    add("look-up", "Look up", { pitchRate: -60 }); add("look-down", "Look down", { pitchRate: 60 });
    // The native attack button can swing an axe OR fire a gun. Do not describe
    // every attack as ranged firing; equipment is chosen concurrently.
    add("fire", "Attack straight ahead", { fire: true }); // Available even with no contact/ammo.
    const aim = bindings.aim.length ? "aim" : null;
    if (aim) {
      // Explicit model-chosen goal, NOT an override of stationary attacks. The
      // executor advances only while the CURRENT HUD weapon is the melee axe.
      add("engage", "Engage: aim and attack, close in with axe", { fire: true, meleeApproach: true }, aim);
      add("attack", "Hold position and attack", { fire: true }, aim);
    }
    add("forward-fire", aim ? "Aim and attack while advancing" : "Advance attacking", { forward: 1, fire: true }, aim);
    add("back-fire", aim ? "Aim and attack while retreating" : "Back up attacking", { forward: -1, fire: true }, aim);
    add("left-fire", aim ? "Aim and attack moving left" : "Strafe left attacking", { side: -1, fire: true }, aim);
    add("right-fire", aim ? "Aim and attack moving right" : "Strafe right attacking", { side: 1, fire: true }, aim);
    if (bindings.item.length) add("approach", "Approach item", { forward: 1 }, "item");
    add("jump", "Jump forward", { forward: 1, jump: true });
    add("swim-up", "Swim up", { up: 1 }); add("swim-down", "Swim down", { up: -1 });
    // Equipment accompanies the tactic; selecting an already-held gun must not
    // become a turn-consuming no-op. Wait + a weapon still permits a stationary switch.
    add("wait", "Wait");
  }
  const grounding = Object.fromEntries(Object.entries(bindings).filter(([, entries]) => entries.length).map(([key, entries]) => [key, {
    type: "choice", instructions: key === "aim" ? "Which visible enemy is the urgent threat? Consider attacks, apparent size and damage. Crosshair alignment alone is not priority. Size is not distance."
      : key === "item" ? "Which visible pickup best meets HUD needs? Follow priorities. Size is not distance."
      : "Best owned weapon? Use strongest effective loaded gun; consider reach and self-harm.",
    criteria: Object.fromEntries(entries.map(e => [e.id, key === "weapon" ? weaponOption(e, observation.player) : targetText(e)])),
  }]));
  return { controlMode: CONTROL_MODE, observationPolicy: OBSERVATION_POLICY, controller: CONTROLLER_POLICY,
    objective: PRIMARY_OBJECTIVE, priorityOrder, objectives: objectivesFor(priorityOrder), offerPolicy: OFFER_POLICY,
    candidates: all, eligible: all, bindings, grounding, memory: structuredClone(memory), visual,
    decisionFormat, sharedState: context, requests: requestsFor(all, context, decisionFormat, grounding) };
}
export function candidates(observation, memory = null, options = {}) { return prepareDecision(observation, memory, options).candidates; }

/** Multiple explicit choice heads share ONE state. This avoids Cartesian-product
 * shortlisting while leaving every target/weapon selection to the model. */
export function requestsFor(eligible, sharedState, decisionFormat = DEFAULT_DECISION_FORMAT, grounding = {}) {
  validateDecisionFormat(decisionFormat);
  if (!eligible.length) return [];
  for (const c of eligible) if (c.binding && !grounding[c.binding]) throw new Error(`Missing choice question: ${c.binding}`);
  // Kevala tokenizes each question independently anyway. One question per item
  // in ONE decideMany call preserves per-question usage rather than a misleading
  // aggregate (four clipped 512-token questions otherwise report 2048 tokens).
  const actions = decisionFormat === "noul" ? eligible.map(c => ({ state: c.state, questions: structuredClone(NOUL_BASELINE_QUESTION) })) :
    [{ state: sharedState, questions: { action: { type: "choice",
      instructions: `Which tactic helps ${PRIMARY_OBJECTIVE}? Follow listed priorities, highest first. Use recent outcomes; equipment is concurrent.`,
      criteria: Object.fromEntries(eligible.map(c => [optionId(c), c.choiceText])),
    } } }];
  return actions.concat(Object.entries(grounding).map(([name, question]) => ({ state: sharedState, questions: { [name]: structuredClone(question) } })));
}

export function rankDecision(record) {
  if (!Array.isArray(record.responses) || record.responses.length !== record.requests.length) throw new Error("Model returned an unexpected response count.");
  const count = record.decisionFormat === "choice" ? 1 : record.eligible.length;
  return rankResponses(record.responses.slice(0, count), record.eligible, record.decisionFormat);
}

/** Validate and rank the UNMODIFIED response for inspection. SDK argmax breaks
 * rounded ties in this ranking; choice execution samples separately, not ranking[0]. */
export function rankResponses(responses, eligible, decisionFormat = DEFAULT_DECISION_FORMAT) {
  validateDecisionFormat(decisionFormat);
  if (!Array.isArray(responses) || responses.length !== (decisionFormat === "choice" ? 1 : eligible.length) || !eligible.length) throw new Error("Model returned an unexpected response count.");
  let selectedId = null, probabilities;
  if (decisionFormat === "choice") {
    const answer = responses[0]?.answers?.action;
    if (answer?.type !== "choice") throw new Error("Invalid action choice: expected a typed choice answer.");
    const selected = eligible.find(c => optionId(c) === answer.choice);
    if (typeof answer.choice !== "string" || !selected) throw new Error("Invalid action choice: not one of the offered actions.");
    selectedId = selected.id;
    probabilities = answer.probabilities;
    if (!probabilities || Array.isArray(probabilities) || typeof probabilities !== "object" || Object.keys(probabilities).length !== eligible.length || eligible.some(c => !Object.hasOwn(probabilities, optionId(c)))) throw new Error("Invalid action probabilities: keys must match the offered actions.");
  }
  const ranking = eligible.map((candidate, index) => {
    const probability = decisionFormat === "choice" ? probabilities[optionId(candidate)] : responses[index]?.answers?.favorable?.noul;
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error(`Invalid ${decisionFormat} probability for candidate ${index}.`);
    return { index, id: candidate.id, probability };
  });
  if (decisionFormat === "choice") {
    const sum = ranking.reduce((n, r) => n + r.probability, 0);
    if (!(sum > 0) || Math.abs(sum - 1) > eligible.length * 0.005 + 1e-8) throw new Error("Invalid action probabilities: distribution does not sum to one within rounding tolerance.");
    if (probabilities[responses[0].answers.action.choice] < Math.max(...ranking.map(r => r.probability))) throw new Error("Invalid action choice: contradicts the public probabilities.");
  }
  return ranking.sort((a, b) => b.probability - a.probability || Number(b.id === selectedId) - Number(a.id === selectedId) || a.index - b.index);
}

/** Sample ONE composite decision. Only used binding heads consume draws. Invalid
 * answers reject the whole command; a rejected/stale decision is never resampled.
 * Independent noul ratings are diagnostic scores, NOT a categorical distribution. */
export function resolveSelection(record, { random = Math.random } = {}) {
  const ranking = rankDecision(record);
  if (record.sampling) throw new Error("This decision has already been sampled; score a fresh observation.");
  record.ranking = ranking;
  const sampling = record.sampling = { method: SAMPLING_METHOD, complete: false, heads: {} };
  function draw(question, entries, responseIndex, answer) {
    const options = entries.map(optionId);
    const sampled = { method: SAMPLING_METHOD, question, responseIndex, options, sdkChoice: answer.choice,
      ...sampleDistribution(options.map(id => answer.probabilities[id]), random) };
    sampled.optionId = options[sampled.index];
    sampling.heads[question] = sampled;
    return sampled;
  }
  if (record.decisionFormat === "choice") {
    record.selectedIndex = draw("action", record.eligible, 0, record.responses[0].answers.action).index;
  } else {
    record.selectedIndex = ranking[0].index;
    sampling.heads.action = { method: "highest-noul-rating", responseIndex: record.selectedIndex,
      optionId: optionId(record.eligible[record.selectedIndex]), index: record.selectedIndex, probability: ranking[0].probability };
  }
  const candidate = record.eligible[record.selectedIndex];
  const choice = { ...candidate, params: { ...candidate.params }, selection: null, weaponSelection: null };
  const relevant = [candidate.binding, record.bindings.weapon.length ? "weapon" : null].filter(Boolean);
  // Validate all USED binding distributions before drawing any of them. Unused
  // responses stay in the trace, but cannot turn a movement into an attack.
  const validated = Object.fromEntries(relevant.map(question => {
    const entries = record.bindings[question];
    const responseIndex = record.requests.findIndex(request => Object.hasOwn(request.questions, question));
    const answer = record.responses[responseIndex]?.answers?.[question];
    try { rankResponses([{ answers: { action: answer } }], entries); }
    catch (error) { throw new Error(`Invalid ${question} selection: ${error.message}`); }
    return [question, { entries, responseIndex, answer }];
  }));
  function select(question) {
    const { entries, responseIndex, answer } = validated[question];
    const sampled = draw(question, entries, responseIndex, answer), selected = entries[sampled.index];
    return { selected, selection: { question, responseIndex, id: selected.id, answer: structuredClone(answer), sampling: sampled } };
  }
  const labels = [candidate.label];
  if (candidate.binding) {
    const { selected, selection } = select(candidate.binding);
    choice.selection = selection; choice.params.ref = selected.ref;
    labels.push(`${selected.id} ${readable(selected.kind)}`);
  }
  if (record.bindings.weapon.length) {
    const { selected, selection } = select("weapon");
    choice.weaponSelection = { ...selection, name: selected.name };
    // Keep the desired ID even when it matched the observed HUD. The native
    // executor checks the CURRENT HUD, since equipment can change during inference.
    choice.params.weapon = selected.weapon;
    labels.push(selected.name);
  }
  choice.label = choice.choiceText = labels.join(" · ");
  sampling.complete = true;
  return choice;
}
