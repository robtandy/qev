// Compile the source annotation manifest into an ignored native build header.
// No assets, entity state, or upstream gamecode is embedded in this table.
export function animationHeader(manifest) {
  const poses = new Set(["unknown", "idle", "moving", "attack", "hurt", "death", "dead", "downed"]);
  const fingerprints = new Set(), names = new Set();
  if (!Array.isArray(manifest?.models) || !manifest.models.length) throw new Error("No animation labels.");
  const ranges = [], models = [];
  for (const [i, model] of manifest.models.entries()) {
    if (!/^progs\/[a-z0-9_]+\.mdl$/.test(model.model) || names.has(model.model) ||
        !/^[0-9a-f]{16}$/.test(model.fnv64) || fingerprints.has(model.fnv64) || !/^[0-9a-f]{64}$/.test(model.sha256) ||
        !Number.isSafeInteger(model.bytes) || model.bytes < 1 || model.bytes > 256 * 1024 * 1024 ||
        !Number.isSafeInteger(model.frames) || model.frames < 1 || model.frames > 4096 || !Array.isArray(model.ranges)) throw new Error("Invalid animation model.");
    names.add(model.model); fingerprints.add(model.fnv64);
    let next = 0;
    const entries = model.ranges.map(range => {
      if (!Array.isArray(range) || range.length !== 3 || range[0] !== next || !Number.isSafeInteger(range[1]) ||
          range[1] < range[0] || range[1] >= model.frames || !poses.has(range[2])) throw new Error("Invalid animation ranges.");
      next = range[1] + 1;
      return `{${range[0]}, ${range[1]}, "${range[2]}"}`;
    });
    if (next !== model.frames) throw new Error("Incomplete animation ranges.");
    ranges.push(`/* ${model.model}; SHA-256 ${model.sha256} */\nstatic const qev_animation_range_t ranges_${i}[] = {${entries.join(", ")}};`);
    models.push(`    {UINT64_C(0x${model.fnv64}), ${model.bytes}, ${model.frames}, ${entries.length}, ranges_${i}}`);
  }
  return `/* Generated from engine/animation-labels.json; do not edit build output. */\n${ranges.join("\n")}\nstatic const qev_animation_model_t known_models[] = {\n${models.join(",\n")}\n};\n`;
}
