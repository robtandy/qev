// Verify the exact upstream source and its generated WebAssembly. The package
// version alone cannot distinguish the published npm release from current code.
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { KEVALA_RUNTIME } from "../src/kevala-runtime.js";

export const KEVALA_PACKAGE = "node_modules/kevala";
export const KEVALA_BUILD = "build/kevala-runtime.json";
export const KEVALA_SOURCE = `https://codeload.github.com/bvolpato/kevala/tar.gz/${KEVALA_RUNTIME.revision}`;
export const KEVALA_PIN = Object.freeze({ ...KEVALA_RUNTIME, source: KEVALA_SOURCE, rust: "1.95.0",
  integrity: "sha512-ekTvJiBVB4dpqmxd2oqJGy0VZ0btQH/LYpiN1EaEbTJ2Bg21mseSBw755BOnW5IGGOmYPsJ/bCi1rihINko8/Q==",
  sourceDigest: "3a5c705abf58ec09a1c4093cb2d0c79fddea4d28c7a6c0018f1b2ced71940658" });
export const KEVALA_WASM = Object.freeze(["kevala-relaxed.wasm", "kevala-simd.wasm", "kevala-base.wasm"]);
export const KEVALA_SOURCE_FILES = Object.freeze(["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "scripts/build-wasm.sh",
  "scripts/check-wasm.mjs", "scripts/lib/wasm-abi.mjs", "package.json", "LICENSE", "THIRD_PARTY_NOTICES"]);
export const KEVALA_SOURCE_DIRS = Object.freeze(["js/src", "crates"]);
const generated = new Set(KEVALA_WASM.map(name => `js/src/${name}`));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

async function file(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Kevala inputs must be regular files, not symlinks.");
  return readFile(path);
}
export async function kevalaSourceDigest(directory) {
  const names = [...KEVALA_SOURCE_FILES];
  async function walk(parent) {
    const info = await lstat(resolve(directory, parent));
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Kevala source directories must not be symlinks.");
    for (const entry of await readdir(resolve(directory, parent), { withFileTypes: true })) {
      const name = `${parent}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("Kevala source must not contain symlinks.");
      if (entry.isDirectory()) await walk(name);
      else if (!generated.has(name)) names.push(name);
    }
  }
  for (const subdirectory of KEVALA_SOURCE_DIRS) await walk(subdirectory);
  const h = createHash("sha256"), checked = new Set();
  for (const name of names.sort()) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (checked.has(parent)) continue;
      const info = await lstat(resolve(directory, parent));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Kevala source directories must not be symlinks.");
      checked.add(parent);
    }
    h.update(name + "\0").update(await file(resolve(directory, name))).update("\0");
  }
  return h.digest("hex");
}
export async function verifyKevalaSource(root, pin = KEVALA_PIN) {
  const directory = resolve(root, KEVALA_PACKAGE), info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Kevala must be an installed directory, not a linked checkout.");
  const app = JSON.parse(await file(resolve(root, "package.json")));
  const lock = JSON.parse(await file(resolve(root, "package-lock.json")));
  const installed = JSON.parse(await file(resolve(directory, "package.json")));
  const entry = lock.packages?.[KEVALA_PACKAGE];
  if (app.dependencies?.kevala !== pin.source || entry?.resolved !== pin.source || entry.integrity !== pin.integrity ||
      installed.name !== "kevala" || installed.version !== pin.packageVersion || entry.version !== pin.packageVersion)
    throw new Error("Kevala package/lockfile is not the pinned upstream revision. Run npm ci --ignore-scripts.");
  if (await kevalaSourceDigest(directory) !== pin.sourceDigest)
    throw new Error("Kevala source mismatch; do not patch the dependency. Run npm ci --ignore-scripts.");
  return installed;
}
export async function kevalaWasmInventory(root) {
  return Promise.all(KEVALA_WASM.map(async name => {
    const bytes = await file(resolve(root, KEVALA_PACKAGE, "js/src", name));
    if (!bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error(`Invalid Kevala WebAssembly: ${name}`);
    return { name, bytes: bytes.length, sha256: hash(bytes) };
  }));
}
export async function verifyKevalaRuntime(root, pin = KEVALA_PIN) {
  await verifyKevalaSource(root, pin);
  let build;
  try { build = JSON.parse(await file(resolve(root, KEVALA_BUILD))); }
  catch { throw new Error("Kevala runtime is not built. Run npm run setup:kevala."); }
  if (build.version !== 1 || build.revision !== pin.revision || build.packageVersion !== pin.packageVersion ||
      build.sourceDigest !== pin.sourceDigest || build.rust !== pin.rust || build.source !== pin.source)
    throw new Error("Kevala build/source mismatch. Run npm run setup:kevala.");
  let wasm;
  try { wasm = await kevalaWasmInventory(root); }
  catch (error) { throw new Error("Kevala WebAssembly is missing or invalid. Run npm run setup:kevala.", { cause: error }); }
  if (JSON.stringify(wasm) !== JSON.stringify(build.wasm)) throw new Error("Kevala WebAssembly changed or is stale. Run npm run setup:kevala.");
  return build;
}
