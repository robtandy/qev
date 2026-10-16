// One runtime only. A revisioned directory prevents cached JS/WASM from mixing
// with the older npm build, which unfortunately has the same package version.
export const KEVALA_RUNTIME = Object.freeze({ name: "kevala", packageVersion: "0.1.3",
  revision: "e250209f507f8a9a17d9a24fb8c6e197424890c3" });
export const KEVALA_ASSET_PATH = `vendor/kevala/${KEVALA_RUNTIME.revision}/`;
export const KEVALA_ENTRY = `${KEVALA_ASSET_PATH}index.js`;

// Hold the existing weights fixed while replacing the runtime. In particular,
// the new upstream Kev name defaults to a different checkpoint and BF16 download.
// These are immutable, public Q8 packs, not an old-runtime fallback.
const PACK_ROOT = "https://huggingface.co/bvolpato/kevala-packs/resolve/e75a06d9329e19fe879f44cfcce33914fb96dade";
export const MODEL_PACKS = Object.freeze({
  laya: Object.freeze({ repo: "convaiinnovations/laya", revision: "1c5edc17a7acd8701df6fc341c0d179f1c62c982",
    hosted: `${PACK_ROOT}/laya-q8.kevala`, pack: 478886720,
    packSha256: "b9cab75c38f026236b8d736377aa40f889d842c219d37da45cc06c782395555c" }),
  "kev-0.8b": Object.freeze({ repo: "jaredpalmer/kev-0.8b", revision: "54f4f8777356cd5bbbb6c6919c657f26e6f2f6d8",
    hosted: `${PACK_ROOT}/kev-0.8b-q8.kevala`, pack: 857259584,
    packSha256: "8c4859f55d38b29bb5a024791b781f9ed978bd90f88ce9bce16219bd4461eca2",
    base: Object.freeze({ repo: "Qwen/Qwen3.5-0.8B-Base", revision: "dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68" }) }),
});

export function kevalaOptions(name, backend) {
  if (!Object.hasOwn(MODEL_PACKS, name)) throw new Error("Choose Laya or Kev before loading a model.");
  if (!["auto", "wasm"].includes(backend)) throw new Error("Choose Auto / GPU or CPU / WASM as the backend.");
  const pack = MODEL_PACKS[name];
  return { model: { name, label: name, ...pack, ...(pack.base ? { base: { ...pack.base } } : {}),
    license: "apache-2.0", block: 32, browserConvert: false },
    backend, from: "pack", precision: "q8", gpuKernel: "auto" };
}
