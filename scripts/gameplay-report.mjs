// Evaluation only: never imported by the app or its decision controller.
export const GAMEPLAY_BAR = Object.freeze({ kills: 2, movingTicks: 60, displacement: 128, attackTicks: 30, stallSeconds: 15 });

/** Do not confuse inference/keypresses/ammo spent with useful gameplay. */
export function gradeGameplay({ start, end, metrics, longestNoProgress, records }) {
  const failures = [];
  const kills = end.player?.kills - start.player?.kills;
  if (!Number.isSafeInteger(kills) || kills < GAMEPLAY_BAR.kills) failures.push(`only ${Number.isFinite(kills) ? kills : "unknown"} confirmed level kills (need ${GAMEPLAY_BAR.kills})`);
  if (metrics?.testOnly !== true || ![metrics.distance, metrics.maxDisplacement, metrics.movingTicks, metrics.attackTicks].every(n => Number.isFinite(n) && n >= 0)) {
    failures.push("missing/invalid isolated motion instrumentation");
  } else {
    if (metrics.movingTicks < GAMEPLAY_BAR.movingTicks || metrics.maxDisplacement < GAMEPLAY_BAR.displacement)
      failures.push(`insufficient real movement (${metrics.movingTicks} moving ticks, ${metrics.maxDisplacement} maximum displacement)`);
    if (metrics.attackTicks < GAMEPLAY_BAR.attackTicks) failures.push("insufficient actual attack input; scoreboard kills alone do not demonstrate attacking");
  }
  if (!Number.isFinite(longestNoProgress) || longestNoProgress > GAMEPLAY_BAR.stallSeconds)
    failures.push(`${Number.isFinite(longestNoProgress) ? longestNoProgress.toFixed(1) : "unknown"} seconds without translation or a kill`);
  if (!end.alive) failures.push("player died");
  if (records.some(r => r.status === "error")) failures.push("controller/model error");
  if (!records.some(r => r.appliedAt && r.execution?.ticksApplied > 0)) failures.push("no model choice actually executed");
  return { passed: failures.length === 0, failures, kills };
}
