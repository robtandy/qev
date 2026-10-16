// Build the one pinned upstream runtime; never edit it or substitute the npm
// release / live website. Outputs and compiler caches remain ignored in Git.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KEVALA_BUILD, KEVALA_PACKAGE, KEVALA_PIN, kevalaWasmInventory, verifyKevalaRuntime, verifyKevalaSource } from "./kevala-runtime.mjs";

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw new Error(`Cannot run ${command}. Install rustup, then run npm run setup:kevala.`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}); Kevala was not installed.`);
}
export async function setupKevala(root, { force = false } = {}) {
  await verifyKevalaSource(root); // Verify BEFORE executing any upstream build script.
  if (!force) {
    try {
      const build = await verifyKevalaRuntime(root);
      console.log(`Kevala ${build.revision.slice(0, 7)}: verified existing Rust ${build.rust} build.`);
      return build;
    } catch { /* Missing/partial/stale generated output is rebuilt from verified source. */ }
  }
  const vendor = resolve(root, KEVALA_PACKAGE), env = { ...process.env, RUSTUP_TOOLCHAIN: KEVALA_PIN.rust };
  run("rustup", ["toolchain", "install", KEVALA_PIN.rust, "--profile", "minimal", "--target", "wasm32-unknown-unknown"], root);
  run("bash", [resolve(vendor, "scripts/build-wasm.sh")], vendor, env);
  run(process.execPath, [resolve(vendor, "scripts/check-wasm.mjs")], vendor, env);
  await verifyKevalaSource(root); // The build must not have patched its JS/Rust source.
  const build = { version: 1, name: KEVALA_PIN.name, packageVersion: KEVALA_PIN.packageVersion,
    revision: KEVALA_PIN.revision, source: KEVALA_PIN.source, sourceDigest: KEVALA_PIN.sourceDigest,
    rust: KEVALA_PIN.rust, builtAt: new Date().toISOString(), wasm: await kevalaWasmInventory(root) };
  await mkdir(resolve(root, "build"), { recursive: true });
  await writeFile(resolve(root, KEVALA_BUILD), JSON.stringify(build, null, 2) + "\n");
  await verifyKevalaRuntime(root);
  console.log(`Kevala ${build.revision.slice(0, 7)} built and verified. No weights or old runtime were bundled.`);
  return build;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--force")) throw new Error("Usage: npm run setup:kevala [-- --force]");
  await setupKevala(resolve(dirname(fileURLToPath(import.meta.url)), ".."), { force: process.argv.includes("--force") });
}
