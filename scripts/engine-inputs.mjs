// Inputs controlling the published native build. The digest prevents packaging
// a stale engine with source from a different working tree.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export const ENGINE_MODULES = ["qev_bridge.c", "qev_bridge.h", "qev_pixels.c", "qev_pixels.h",
  "qev_animation.c", "qev_animation.h", "qev_recenter.c", "qev_recenter.h", "qev_nearest.c", "qev_nearest.h"];
export const ENGINE_INPUTS = [...ENGINE_MODULES.map(name => `engine/${name}`), "engine/animation-labels.json", "engine/qwasm.patch",
  "scripts/animation-data.mjs", "scripts/build-engine.mjs", "scripts/engine-inputs.mjs", "scripts/setup-toolchain.sh"];
export async function engineSourceDigest(root) {
  const hash = createHash("sha256");
  for (const name of [...ENGINE_INPUTS].sort()) hash.update(name + "\0").update(await readFile(resolve(root, name))).update("\0");
  return hash.digest("hex");
}
