// Explicitly synthetic visible-frame/HUD fixtures, not a captured game observation.
export const visible = (kind, ref = 10, bounds = [0.4, 0.4, 0.6, 0.65], extra = {}) => ({
  kind, ref, visible: true, pose: "unknown", screen: { bounds, pixels: 300, aimOverlap: true, clipped: false, sameKindCount: 1 }, ...extra,
});
export function observation() {
  return { version: 4, controlMode: "player-observable", ready: true, paused: true, owned: true, alive: true, completed: false,
    map: "test", difficulty: 2, epoch: 3, tick: 42, remaining: 0, controlSession: 1, actionSerial: 0, actionTicks: 0, actionTicksLeft: 0,
    player: { health: 28, armor: 0, ammo: 8, weapon: "shotgun", shells: 8, nails: 0, rockets: 0, cells: 0,
      grounded: true, inWater: false, silverKey: false, goldKey: false,
      weapons: [{ id: 1, name: "axe" }, { id: 2, name: "shotgun" }], powerups: {} },
    screen: { source: "renderer-visible-pixels", available: true, frame: 1, tick: 42, viewport: [0, 0, 640, 432], distorted: false, reason: null },
    scene: Array.from({ length: 9 }, (_, i) => i >= 6 ? [20000, 0, 0, 0, 0, 0, 0, 0] : [0, 20000, 0, 0, 0, 0, 0, 0]),
    enemies: [visible("monster_army", 10)], pickups: [visible("health", 20)], features: [],
    enemiesOmitted: 0, pickupsOmitted: 0, featuresOmitted: 0,
    audio: { source: "mixed-sound-captions", available: false, events: [] },
  };
}
export function advance(s, ticks = 1) { s.tick += ticks; s.screen.tick = s.tick; s.screen.frame++; return s; }
