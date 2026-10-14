import { screenCues, fallenEnemy } from "./screen.js";
import { WEAPONS } from "./weapons.js";
export { WEAPONS } from "./weapons.js";

export const SURFACES = Object.freeze(["floor-like", "wall-like", "ceiling", "slope", "sky", "water", "lava", "slime"]);
const GROUPS = { enemy: "enemies", pickup: "pickups", feature: "features" };
const int = (n, max = 1_000_000) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const LABELS = { monster_army: "grunt", monster_shalrath: "vore", weapon_supershotgun: "double shotgun",
  weapon_supernailgun: "super nailgun", item_artifact_invulnerability: "invulnerability", item_artifact_super_damage: "quad",
  item_artifact_envirosuit: "suit", item_artifact_invisibility: "invisibility", item_spikes: "nails" };
export const readable = kind => LABELS[kind] || kind.replace(/^(monster_|weapon_|item_)/, "").replaceAll("_", " ");
export const horizontal = e => e.bounds[2] < 0.5 ? "left" : e.bounds[0] > 0.5 ? "right" : "center";

/** Copy only whitelisted player-perceptible evidence. Opaque refs are executor
 * capabilities for THIS visible frame, never used for memory/identity matching. */
export function perception(observation, visual = screenCues(observation)) {
  const contacts = visual.available ? visual.entities.map(e => {
    const ref = observation[GROUPS[e.group]]?.[e.sourceIndex]?.ref;
    return { ...e, bounds: [...e.bounds], id: `${e.group[0]}${e.sourceIndex + 1}`, ref: int(ref, 2147483647) && ref > 0 ? ref : null };
  }) : [];
  const scene = [];
  if (visual.available && Array.isArray(observation.scene) && observation.scene.length === 9) {
    const maximum = Math.ceil(visual.viewport[2] / 3) * Math.ceil(visual.viewport[3] / 3);
    for (const cell of observation.scene) {
      if (!Array.isArray(cell) || cell.length !== SURFACES.length || !cell.every(n => int(n, maximum)) || cell.reduce((a, b) => a+b, 0) > maximum) { scene.length = 0; break; }
      scene.push([...cell]);
    }
  }
  const audio = observation.audio;
  const sounds = audio?.source === "mixed-sound-captions" && Array.isArray(audio.events) ? audio.events.slice(0, 4).filter(e =>
    ["weapon", "mechanism", "pickup", "hurt_or_movement", "ambience", "water", "creature_or_effect", "sound"].includes(e.kind) &&
    ["left", "right", "center"].includes(e.direction) && ["quiet", "clear"].includes(e.loudness) && int(e.ageTicks, 120))
    .map(e => ({ kind: e.kind, direction: e.direction, loudness: e.loudness, ageTicks: e.ageTicks })) : [];
  const weapons = Array.isArray(observation.player?.weapons) ? observation.player.weapons.filter(w =>
    int(w.id, 8) && w.id > 0 && w.name === WEAPONS[w.id - 1]).map(w => ({ id: w.id, name: w.name })) : [];
  return { available: visual.available, viewport: visual.available ? [...visual.viewport] : null, contacts, scene, sounds, weapons: [...new Map(weapons.map(w => [w.id, w])).values()],
    omitted: ["enemies", "pickups", "features"].reduce((sum, g) => sum + (int(observation[`${g}Omitted`]) ? observation[`${g}Omitted`] : 0), 0) };
}

const size = e => e.height < 0.04 ? "tiny" : e.height < 0.12 ? "small" : e.height < 0.3 ? "medium" : "large";
export const poseText = e => e.group !== "enemy" ? "" : ({ death: "dying", dead: "dead/corpse",
  downed: "downed, may revive", attack: "attacking", hurt: "hurt" }[e.pose] || "");
/** Put individual screen geometry in the relevant choice head, where the model
 * chooses the actual contact. No tactic-specific target shortlist is needed. */
export function targetText(e) {
  const kind = e.kind === "item_shells" ? "shotgun ammo" : readable(e.kind);
  const role = fallenEnemy(e) ? "" : e.kind === "monster_knight" ? "/melee" : e.kind === "monster_ogre" ? "/grenades" : "";
  const pose = poseText(e) ? ` ${poseText(e)}` : "";
  return `${kind}${role} ${horizontal(e)} ${e.y < 0.35 ? "high" : e.y > 0.65 ? "low" : "mid"} ${size(e)}${pose}${e.aimOverlap ? " crosshair" : ""}${e.clipped ? " edge" : ""}`;
}
/** Factor identical appearance wording, retaining EVERY capped contact/kind and
 * count. Never mix enemy/pickup/effect groups or unlike pose/trend wording. This saves
 * repetition, not evidence, so the shared state can also carry the full inventory.
 * Individual targets/measurements remain in choice heads and the exact trace. */
export function viewText(p) {
  const groups = new Map();
  for (const e of p.contacts) {
    const pose = poseText(e) ? ` ${poseText(e)}` : "";
    const trend = ["growing", "shrinking"].includes(e.trend) ? ` ${e.trend}` : "";
    const appearance = `${horizontal(e)} ${size(e)}${pose}${trend}`, key = `${e.group}:${appearance}`;
    if (!groups.has(key)) groups.set(key, { appearance, kinds: new Map() });
    const kinds = groups.get(key).kinds, name = readable(e.kind);
    kinds.set(name, (kinds.get(name) || 0) + 1);
  }
  return [...groups.values()].map(({ appearance, kinds }) => {
    const names = [...kinds].map(([name, count]) => `${count > 1 ? `${count}x ` : ""}${name}`);
    return names.length === 1 ? `${names[0]} ${appearance}` : `${appearance}: ${names.join(", ")}`;
  }).join("; ");
}
export function sceneText(p) {
  if (!p.scene.length) return "";
  // Lower-screen coverage is a visual description, not floor support or a route.
  const lower = p.scene.slice(6).map(cell => {
    const total = Math.max(1, p.viewport[2] * p.viewport[3] / 9);
    // Unknown/occluding pixels still count in the denominator. A few floor pixels
    // behind an actor must not become a whole "floor" region. Keep tiny visible
    // liquid/hazard fragments even alongside two larger solid-surface categories.
    const kinds = cell.map((n, kind) => ({ n, kind })).filter(s => s.n > 0 && (s.n/total >= 0.15 || s.kind >= 5))
      .sort((a, b) => b.n-a.n).filter((s, rank) => rank < 2 || s.kind >= 5).map(s => SURFACES[s.kind]);
    return kinds.join("/") || "unclassified";
  });
  const grouped = new Map();
  lower.forEach((text, i) => grouped.set(text, [...(grouped.get(text) || []), ["L", "C", "R"][i]]));
  const descriptions = [...grouped].map(([text, columns]) => `${columns.join("/")} ${text}`);
  const elsewhere = [6, 7].filter(kind => p.scene.slice(0, 6).some(cell => cell[kind] > 0) && !p.scene.slice(6).some(cell => cell[kind] > 0)).map(kind => SURFACES[kind]);
  return `Lower view: ${descriptions.join("; ")}${elsewhere.length ? `; elsewhere ${elsewhere.join("/")}` : ""}. Not a safe-route test.`;
}
const signature = p => JSON.stringify([p.contacts.map(e => [e.group, e.kind, e.pose, Math.round(e.x*5), Math.round(e.y*5), Math.round(e.height*10)]),
  p.scene.map(cell => cell.indexOf(Math.max(...cell)))]);

/** Bounded observed history, no GPS/visited-cell map or live updates of unseen things.
 * Last-seen direction is explicitly in the OLD view, not the current camera frame.
 * Similar images do not establish that two places are the same location. */
export class ObservationMemory {
  constructor() { this.reset(); }
  reset() { this.epoch = null; this.last = null; this.past = []; this.actions = []; this.repeated = 0; }
  observe(observation, visual) {
    if (!observation.ready || !observation.player) return;
    if (this.epoch !== observation.epoch || observation.tick < (this.last?.tick ?? 0)) { this.reset(); this.epoch = observation.epoch; }
    const p = perception(observation, visual);
    if (!p.available) return; // Lack of a frame is not evidence an enemy disappeared.
    if (this.last?.frame === observation.screen.frame) return;
    const entry = { tick: observation.tick, frame: observation.screen.frame, signature: signature(p),
      contacts: p.contacts.map(e => ({ group: e.group, kind: e.kind, pose: e.pose, side: horizontal(e) })) };
    if (!this.last || entry.signature !== this.last.signature) this.past.push(entry);
    else if (this.past.length) this.past[this.past.length - 1] = entry;
    this.last = entry;
    this.past = this.past.filter(e => observation.tick-e.tick <= 1800).slice(-16);
  }
  outcome(choice, before, after, ticksApplied) {
    if (!after.player || after.epoch !== before.epoch || this.epoch !== after.epoch || !(ticksApplied > 0)) return;
    const beforeSignature = signature(perception(before)), afterSignature = signature(perception(after));
    const sameView = before.screen?.available === true && after.screen?.available === true && beforeSignature === afterSignature;
    this.repeated = sameView ? this.repeated + 1 : 0;
    this.actions.push({ tick: after.tick, action: choice.label, actionId: choice.id, damage: Math.max(0, before.player.health - after.player.health),
      healthChange: after.player.health - before.player.health,
      ammoChange: before.player.weapon === after.player.weapon ? after.player.ammo - before.player.ammo : null,
      weaponChanged: before.player.weapon !== after.player.weapon,
      // The public level counter is progress, not attribution to this particular target.
      killsChange: int(before.player.kills) && int(after.player.kills) ? Math.max(0, after.player.kills - before.player.kills) : null,
      ...(choice.weaponSelection ? { weaponRequested: choice.weaponSelection.name, weaponEquipped: after.player.weapon === choice.weaponSelection.name } : {}),
      sameView, ticksApplied });
    this.actions = this.actions.filter(e => after.tick-e.tick <= 1800).slice(-8);
  }
  describe(observation, visual) {
    if (this.epoch !== observation.epoch) return { pastSightings: [], actions: [], repeated: 0 };
    const currentKinds = new Set(perception(observation, visual).contacts.map(e => `${e.group}:${e.kind}`));
    const seen = new Set(), pastSightings = [];
    for (const past of this.past.toReversed()) for (const c of past.contacts) {
      const key = `${c.group}:${c.kind}`;
      if (currentKinds.has(key) || seen.has(key) || observation.tick-past.tick > 1800) continue;
      seen.add(key); pastSightings.push({ ...c, ageTicks: observation.tick-past.tick });
    }
    return { pastSightings: pastSightings.slice(0, 4), actions: this.actions.filter(a => observation.tick-a.tick <= 1800).map(a => ({ ...a })), repeated: this.repeated };
  }
}
