import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KEVALA_RUNTIME, KEVALA_ASSET_PATH, KEVALA_ENTRY, MODEL_PACKS, kevalaOptions } from "../src/kevala-runtime.js";
import { KEVALA_PACKAGE, KEVALA_BUILD, KEVALA_PIN, KEVALA_SOURCE_FILES, KEVALA_SOURCE_DIRS, KEVALA_WASM,
  kevalaSourceDigest, kevalaWasmInventory, verifyKevalaRuntime, verifyKevalaSource } from "../scripts/kevala-runtime.mjs";
import { diagnosticSummary } from "../src/diagnostics.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Synthetic source/build fixture, NOT a runnable model or a performance result.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "qev-kevala-")), vendor = join(root, KEVALA_PACKAGE);
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of KEVALA_SOURCE_DIRS) await mkdir(join(vendor, name), { recursive: true });
  for (const name of KEVALA_SOURCE_FILES) {
    await mkdir(dirname(join(vendor, name)), { recursive: true });
    await writeFile(join(vendor, name), name === "package.json" ? JSON.stringify({ name: "kevala", version: KEVALA_PIN.packageVersion }) : `fixture ${name}`);
  }
  await writeFile(join(vendor, "js/src/index.js"), "export const fixture = true;");
  await writeFile(join(vendor, "crates/kernel.wgsl"), "// fixture kernel");
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { kevala: KEVALA_PIN.source } }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ packages: { [KEVALA_PACKAGE]: {
    version: KEVALA_PIN.packageVersion, resolved: KEVALA_PIN.source, integrity: KEVALA_PIN.integrity } } }));
  const pin = { ...KEVALA_PIN, sourceDigest: await kevalaSourceDigest(vendor) };
  for (const name of KEVALA_WASM) await writeFile(join(vendor, "js/src", name), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const build = { version: 1, revision: pin.revision, packageVersion: pin.packageVersion, source: pin.source,
    rust: pin.rust, sourceDigest: pin.sourceDigest, wasm: await kevalaWasmInventory(root) };
  await mkdir(join(root, "build")); await writeFile(join(root, KEVALA_BUILD), JSON.stringify(build));
  return { root, vendor, pin, build };
}

test("installed source matches the immutable upstream archive, not just the unchanged 0.1.3 label", async () => {
  await verifyKevalaSource(root);
  assert.match(KEVALA_RUNTIME.revision, /^[a-f0-9]{40}$/);
  assert.equal(KEVALA_PIN.source, `https://codeload.github.com/bvolpato/kevala/tar.gz/${KEVALA_RUNTIME.revision}`);
  assert.equal(KEVALA_ENTRY, `${KEVALA_ASSET_PATH}index.js`);
  assert.ok(KEVALA_ASSET_PATH.includes(KEVALA_RUNTIME.revision));
});

test("the same public Q8 weight packs remain pinned, with measured GPU-kernel selection and no conversion/model fallback", () => {
  for (const name of Object.keys(MODEL_PACKS)) for (const backend of ["auto", "wasm"]) {
    const options = kevalaOptions(name, backend), pack = MODEL_PACKS[name];
    assert.equal(options.model.name, name); assert.equal(options.model.hosted, pack.hosted);
    assert.equal(options.model.packSha256, pack.packSha256); assert.match(pack.packSha256, /^[a-f0-9]{64}$/);
    assert.equal(options.model.browserConvert, false); assert.equal(options.from, "pack");
    assert.equal(options.precision, "q8"); assert.equal(options.gpuKernel, "auto"); assert.equal(options.backend, backend);
    assert.equal(options.submit, undefined, "do not silently change scheduling as well as the runtime");
    options.model.pack = 0; assert.equal(kevalaOptions(name, backend).model.pack, pack.pack);
  }
  assert.equal(MODEL_PACKS.laya.pack, 478886720); assert.equal(MODEL_PACKS["kev-0.8b"].pack, 857259584);
  assert.equal(MODEL_PACKS["kev-0.8b"].revision, "54f4f8777356cd5bbbb6c6919c657f26e6f2f6d8");
  for (const name of ["", "unknown", "__proto__", "constructor", "https://example.org/model"]) assert.throws(() => kevalaOptions(name, "auto"), /Choose Laya or Kev/);
  assert.throws(() => kevalaOptions("laya", "unknown"), /backend/);
});

test("matching source and all three generated artifacts pass build verification", async t => {
  const f = await fixture(t); assert.deepEqual(await verifyKevalaRuntime(f.root, f.pin), f.build);
  assert.equal(await kevalaSourceDigest(f.vendor), f.pin.sourceDigest, "generated Wasm is separate from source identity");
});

for (const name of ["js/src/index.js", "crates/kernel.wgsl", "scripts/build-wasm.sh", "Cargo.lock"]) {
  test(`changed ${name} is rejected before any upstream build can run`, async t => {
    const f = await fixture(t); await writeFile(join(f.vendor, name), "changed");
    await assert.rejects(verifyKevalaRuntime(f.root, f.pin), /source mismatch/);
  });
}

test("an added runtime module is a source change, not silently included in Pages", async t => {
  const f = await fixture(t); await writeFile(join(f.vendor, "js/src/unreviewed.js"), "export const unexpected = true;");
  await assert.rejects(verifyKevalaSource(f.root, f.pin), /source mismatch/);
});

test("an unpinned manifest, wrong lock integrity, or missing build metadata cannot masquerade as current runtime", async t => {
  const f = await fixture(t), app = join(f.root, "package.json"), lock = join(f.root, "package-lock.json");
  const original = await readFile(app); await writeFile(app, JSON.stringify({ dependencies: { kevala: "0.1.3" } }));
  await assert.rejects(verifyKevalaSource(f.root, f.pin), /package\/lockfile/); await writeFile(app, original);
  const raw = await readFile(lock), value = JSON.parse(raw); value.packages[KEVALA_PACKAGE].integrity = "wrong";
  await writeFile(lock, JSON.stringify(value)); await assert.rejects(verifyKevalaSource(f.root, f.pin), /package\/lockfile/);
  await writeFile(lock, raw); await rm(join(f.root, KEVALA_BUILD));
  await assert.rejects(verifyKevalaRuntime(f.root, f.pin), /setup:kevala/);
});

for (const key of ["revision", "sourceDigest", "rust", "source"]) test(`stale build ${key} is rejected`, async t => {
  const f = await fixture(t); await writeFile(join(f.root, KEVALA_BUILD), JSON.stringify({ ...f.build, [key]: "stale" }));
  await assert.rejects(verifyKevalaRuntime(f.root, f.pin), /build\/source mismatch/);
});

test("missing, invalid and changed Wasm fail closed even with matching source", async t => {
  const f = await fixture(t), wasm = join(f.vendor, "js/src", KEVALA_WASM[0]);
  await rm(wasm); await assert.rejects(verifyKevalaRuntime(f.root, f.pin), /WebAssembly is missing or invalid/);
  await writeFile(wasm, "not wasm"); await assert.rejects(verifyKevalaRuntime(f.root, f.pin), /WebAssembly is missing or invalid/);
  await writeFile(wasm, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0]));
  await assert.rejects(verifyKevalaRuntime(f.root, f.pin), /WebAssembly changed or is stale/);
});

test("source files and entire linked checkouts cannot point builds into a neighboring worktree", async t => {
  const f = await fixture(t), file = join(f.vendor, "js/src/index.js"), outside = join(f.root, "external.js");
  await rename(file, outside); await symlink(outside, file);
  await assert.rejects(verifyKevalaSource(f.root, f.pin), /symlink/);
  await rm(file); await rename(outside, file);
  const checkout = join(f.root, "neighbor"); await rename(f.vendor, checkout); await symlink(checkout, f.vendor);
  await assert.rejects(verifyKevalaSource(f.root, f.pin), /linked checkout/);
});

test("compact diagnostics identify the runtime and summarize load-time GPU tuning, not inference speed", () => {
  const d = diagnosticSummary({ runtime: KEVALA_RUNTIME, model: { arch: "laya", backend: "webgpu",
    gpuTuning: { method: "timestamp-query", elapsedMs: 100, truncated: false,
      points: [{ shape: "fixture", points: [{ kernel: "generic", privateFixture: "SECRET" }, { kernel: "wide" }, { kernel: "wide" }] }] } } });
  assert.deepEqual(d.runtime, KEVALA_RUNTIME);
  assert.deepEqual(d.model.gpuTuning.selections, { generic: 1, wide: 2 });
  assert.equal(d.model.gpuTuning.elapsedMs, 100); assert.equal(d.latest.length, 0);
  assert.doesNotMatch(JSON.stringify(d), /SECRET/);
});
