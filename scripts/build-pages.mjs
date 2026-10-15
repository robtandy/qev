// Static deployment only. Runtime assets are an explicit allowlist, not a copy
// of the repository/build tree. No weights, test telemetry or private PAKs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_DIRECTORY, readDemoAssets } from "./demo-assets.mjs";
import { DEMO } from "../src/demo-manifest.js";
import { engineSourceDigest } from "./engine-inputs.mjs";
import { buildPageSources, PAGE_SOURCES } from "./pages-sources.mjs";

export const PAGE_ENGINE_FILES = ["qwasm.mjs", "qwasm.wasm", "build.json", "QWASM-LICENSE.txt"];
export async function verifyPageEngine(root) {
  const build = JSON.parse(await readFile(resolve(root, "build/engine/build.json"), "utf8"));
  if (build.evaluationOnly !== false || build.assetsEmbedded !== false) throw new Error("Pages requires the normal, asset-free engine, never the evaluation build.");
  if (build.sourceDigest !== await engineSourceDigest(root)) throw new Error("Engine/source mismatch. Run npm run build:engine before publishing Pages.");
  const exports = WebAssembly.Module.exports(await WebAssembly.compile(await readFile(resolve(root, "build/engine/qwasm.wasm")))).map(e => e.name.replace(/^_/, ""));
  if (exports.includes("qev_evaluation") || !["qev_snapshot", "qev_command", "qev_control_version"].every(name => exports.includes(name))) throw new Error("Invalid or instrumented engine cannot be published.");
  return build;
}
async function copyFile(source, destination) {
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refusing non-file deployment input: ${source}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source));
}
export async function copyRuntimeTree(source, destination, extensions) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) throw new Error(`Refusing a runtime symlink: ${entry.name}`);
    const from = resolve(source, entry.name), to = resolve(destination, entry.name);
    if (entry.isDirectory()) await copyRuntimeTree(from, to, extensions);
    else if (entry.isFile() && extensions.includes(extname(entry.name))) await copyFile(from, to);
  }
}
async function inventory(directory, prefix = "") {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix + entry.name, full = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("A deployment artifact contains a symlink.");
    if (entry.isDirectory()) files.push(...await inventory(full, path + "/"));
    else {
      const bytes = await readFile(full);
      files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
  return files;
}
export async function buildPages(root) {
  const build = await verifyPageEngine(root), demo = await readDemoAssets(resolve(root, DEMO_DIRECTORY));
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const vendor = JSON.parse(await readFile(resolve(root, "node_modules/kevala/package.json"), "utf8"));
  if (vendor.name !== "kevala" || vendor.version !== packageJson.dependencies.kevala) throw new Error("Kevala does not match the pinned package version.");
  const stage = await mkdtemp(resolve(root, "build/pages-site-")), output = resolve(root, "build/site");
  try {
    await copyRuntimeTree(resolve(root, "public"), stage, [".html", ".css", ".svg"]);
    await copyRuntimeTree(resolve(root, "src"), resolve(stage, "src"), [".js"]);
    await copyRuntimeTree(resolve(root, "node_modules/kevala/js/src"), resolve(stage, "vendor/kevala"), [".js", ".wasm"]);
    await copyFile(resolve(root, "node_modules/kevala/LICENSE"), resolve(stage, "vendor/kevala/LICENSE"));
    for (const name of PAGE_ENGINE_FILES) await copyFile(resolve(root, "build/engine", name), resolve(stage, "engine", name));
    await mkdir(resolve(stage, "demo"));
    for (const [name, bytes] of demo) await writeFile(resolve(stage, "demo", name), bytes); // Verified bytes, no second disk lookup.
    await buildPageSources(root, stage, build);
    await writeFile(resolve(stage, ".nojekyll"), "");
    const files = await inventory(stage);
    if (files.some(f => f.bytes >= 100_000_000) || files.reduce((n, f) => n + f.bytes, 0) >= 1_000_000_000) throw new Error("Pages artifact exceeds the deployment size budget.");
    if (files.some(f => /\.(kevala|gguf|safetensors|log|mp4|pak)$/i.test(f.path) && !/^demo\/pak[012]\.pak$/.test(f.path))) throw new Error("Unexpected weights, captures or game assets in Pages output.");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const dirty = !!execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim();
    if (process.env.GITHUB_ACTIONS === "true" && dirty) throw new Error("CI must publish committed source, not a modified working tree.");
    await writeFile(resolve(stage, "deployment.json"), JSON.stringify({ repository: "robtandy/qev", commit, dirty, builtAt: new Date().toISOString(),
      engine: build, demo: DEMO.id, kevala: vendor.version, sources: PAGE_SOURCES, files }, null, 2) + "\n");
    await rm(output, { recursive: true, force: true }); await rename(stage, output);
    console.log(`Pages artifact: ${output} (${(files.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024).toFixed(1)} MiB, ${files.length} files). No model weights or evaluation export.`);
    return output;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPages(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
