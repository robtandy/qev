export const SAMPLING_METHOD = "categorical-v1";

/** Inverse-CDF sampling in OFFER order, not score order. Normalize rounding only:
 * no temperature, top-k/p, rejection sampling or changes to the source weights.
 * The recorded draw and half-open interval reproduce the selection exactly. */
export function sampleDistribution(probabilities, random = Math.random) {
  if (!Array.isArray(probabilities) || !probabilities.length || probabilities.some(p =>
    typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1)) throw new Error("Invalid sampling probabilities.");
  const totalProbability = probabilities.reduce((sum, p) => sum + p, 0);
  if (!(totalProbability > 0) || !Number.isFinite(totalProbability)) throw new Error("Invalid sampling probability total.");
  const draw = random();
  if (typeof draw !== "number" || !Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error("Invalid sampling draw: expected a number in [0, 1).");
  let cumulative = 0;
  for (let index = 0; index < probabilities.length; index++) {
    const probability = probabilities[index], lower = cumulative / totalProbability;
    cumulative += probability;
    const upper = cumulative / totalProbability;
    if (probability > 0 && draw < upper) return { index, draw, probability, totalProbability,
      normalizedProbability: probability / totalProbability, interval: [lower, upper] };
  }
  // The last positive entry's upper bound is exactly total / total === 1.
  // This is an error, never an implicit fallback to a different option.
  throw new Error("Sampling draw did not belong to the distribution.");
}
