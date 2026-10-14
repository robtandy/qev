/** Prompt priorities share stable IDs and exact wording across UI, requests, and traces. */
export const PRIMARY_OBJECTIVE = "WIN";
export const PRIORITIES = Object.freeze([
  { id: "avoid-harm", label: "Avoid harm", prompt: "Evade attacks while making progress; do not camp." },
  { id: "get-supplies", label: "Get supplies", prompt: "Get needed health, armor and ammo without reckless exposure." },
  { id: "handle-threats", label: "Handle threats", prompt: "Defeat active enemies with aimed fire and movement." },
  { id: "explore", label: "Explore / exit", prompt: "Explore for supplies, routes and the exit." },
].map(priority => Object.freeze(priority)));
export const DEFAULT_PRIORITY_ORDER = Object.freeze(PRIORITIES.map(priority => priority.id));

/** Only permutations of the four known priorities are accepted; never repair/drop entries. */
export function validatePriorityOrder(order) {
  if (!Array.isArray(order) || order.length !== DEFAULT_PRIORITY_ORDER.length ||
      !DEFAULT_PRIORITY_ORDER.every(id => order.includes(id))) throw new Error("Priorities must contain each known priority exactly once.");
  return Object.freeze([...order]);
}

export function objectivesFor(order = DEFAULT_PRIORITY_ORDER) {
  return Object.freeze(validatePriorityOrder(order).map(id => PRIORITIES.find(priority => priority.id === id).prompt));
}

export function goalPrompt(order = DEFAULT_PRIORITY_ORDER) {
  return `Goal: ${PRIMARY_OBJECTIVE}: defeat enemies, exit alive. Priorities (highest first): ${objectivesFor(order).map((goal, i) => `${i + 1}. ${goal}`).join(" ")}`;
}

/** Move to the target rank, shifting other entries rather than swapping or mutating history. */
export function movePriority(order, id, index) {
  const next = [...validatePriorityOrder(order)], from = next.indexOf(id);
  if (from < 0 || !Number.isInteger(index) || index < 0 || index >= next.length) throw new Error("Invalid priority move.");
  next.splice(index, 0, ...next.splice(from, 1));
  return Object.freeze(next);
}

// Default snapshots retained for diagnostics/tests; active requests build from their own order.
export const SURVIVAL_OBJECTIVES = objectivesFor();
export const GOAL_PROMPT = goalPrompt();
export { OFFER_POLICY } from "./control.js";
