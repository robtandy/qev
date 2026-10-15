import { perception, readable } from "./perception.js";
import { fallenEnemy } from "./screen.js";
import { strongestLoadedWeapon } from "./weapons.js";

export const AUTOMATIC_POLICY = "nearest-visible-strongest-loaded-v1";
/** The native renderer reports only its nearest-object marker, never coordinates
 * or ranges. Require exactly one current, visible, eligible marked contact. */
export function automaticPlan(observation, seen = perception(observation)) {
  const targets = {}, errors = {};
  for (const [binding, group] of [["aim", "enemy"], ["item", "pickup"]]) {
    const eligible = seen.contacts.filter(e => e.group === group && e.ref !== null && !fallenEnemy(e));
    const nearest = eligible.filter(e => e.nearest);
    targets[binding] = nearest.length === 1 ? { id: nearest[0].id, ref: nearest[0].ref, kind: nearest[0].kind,
      method: "nearest-visible-distance-v1" } : null;
    if (eligible.length && nearest.length !== 1) errors[binding] = "Missing or contradictory nearest-visible marker.";
  }
  return { policy: AUTOMATIC_POLICY, epoch: observation.epoch, tick: observation.tick,
    frame: seen.available ? observation.screen.frame : null, ...targets, errors,
    weapon: strongestLoadedWeapon(seen.weapons, observation.player) };
}

/** Bind at score time for inspection, then again against the fresh application
 * snapshot. The model chose the tactic, not a particular target or weapon. No
 * new sampling, alternate tactic, hidden target, or mid-lease retargeting. */
export function bindAutomatic(candidate, plan) {
  if (plan?.policy !== AUTOMATIC_POLICY) throw new Error("Missing automatic-selection evidence.");
  const label = candidate.tacticLabel ?? candidate.label;
  const choice = { ...candidate, tacticLabel: label, params: { ...candidate.params, ref: 0, weapon: plan.weapon?.weapon ?? 0 },
    selection: null, weaponSelection: plan.weapon ? { ...plan.weapon } : null,
    automatic: { policy: plan.policy, epoch: plan.epoch, tick: plan.tick, frame: plan.frame } };
  const labels = [label];
  if (candidate.binding) {
    const target = plan[candidate.binding];
    if (plan.errors[candidate.binding] || !target) throw new Error(`Automatic ${candidate.binding} unavailable: ${plan.errors[candidate.binding] || "no eligible visible object"}`);
    choice.selection = { ...target, binding: candidate.binding }; choice.params.ref = target.ref;
    labels.push(`nearest ${readable(target.kind)}`);
  }
  if (plan.weapon) labels.push(`auto ${plan.weapon.name}`);
  choice.label = choice.choiceText = labels.join(" · ");
  return choice;
}
