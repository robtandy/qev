// Static, player-learnable weapon mechanics, NOT measured target ranges or an
// automatic weapon picker. The actual held weapon comes from the current HUD.
export const WEAPON_PROFILES = Object.freeze([
  { name: "axe", ammo: null, power: "weak", reach: "contact-only melee, not ranged" },
  { name: "shotgun", ammo: "shells", reach: "ranged pellets; spread at distance" },
  { name: "double shotgun", ammo: "shells", selectAmmo: 2, reach: "stronger ranged spread; best close" },
  { name: "nailgun", ammo: "nails", reach: "ranged nails; travel time" },
  { name: "super nailgun", ammo: "nails", selectAmmo: 2, reach: "stronger ranged nails; travel time" },
  { name: "grenade launcher", ammo: "rockets", reach: "ranged arcing grenades; self-splash" },
  { name: "rocket launcher", ammo: "rockets", reach: "ranged rockets; self-splash" },
  { name: "lightning", ammo: "cells", reach: "limited-range beam; hazardous in water" },
].map((weapon, i) => Object.freeze({ id: i + 1, ...weapon })));
export const WEAPONS = Object.freeze(WEAPON_PROFILES.map(w => w.name));
export const weaponReach = name => WEAPON_PROFILES.find(w => w.name === name)?.reach ?? "reach unknown";
export const WEAPON_GUIDANCE = "Use best loaded gun; axe last resort.";

/** The same validated, deduplicated HUD inventory used to offer equipment.
 * Ammunition/pickups never imply ownership; the held weapon is identified separately. */
export function weaponInventory(weapons) {
  return `Owned weapons: ${weapons.length ? weapons.map(w => w.name).join(", ") : "not reported"}.`;
}

export function weaponOption(weapon, player) {
  const profile = WEAPON_PROFILES.find(w => w.id === weapon.weapon && w.name === weapon.name);
  if (!profile) throw new Error("Unknown weapon profile.");
  const count = profile.ammo ? player?.[profile.ammo] : null, held = profile.name === player?.weapon;
  const ammo = !profile.ammo ? "no ammo needed" : count === 0 ? "EMPTY"
    : `${Number.isSafeInteger(count) && count > 0 ? count : "unknown"} ${profile.ammo}`;
  // Static switch requirements, not an ammo veto. An already-held double/super
  // weapon can fire its ordinary fallback with one round; don't call it unusable.
  const minimum = Number.isSafeInteger(count) && count > 0 && count < (profile.selectAmmo ?? 1) && !held
    ? `; switch needs ${profile.selectAmmo}` : "";
  return `${profile.name}; ${profile.power ? `${profile.power} ` : ""}${profile.reach}; ${ammo}${minimum}${held ? " (held)" : ""}`;
}
