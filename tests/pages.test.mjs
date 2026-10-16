import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appURL } from "../src/paths.js";
import { KEVALA_ASSET_PATH } from "../src/kevala-runtime.js";
import { copyRuntimeTree, PAGE_ENGINE_FILES, verifyPageEngine } from "../scripts/build-pages.mjs";
import { ENGINE_INPUTS, engineSourceDigest } from "../scripts/engine-inputs.mjs";
import { PAGE_SOURCES } from "../scripts/pages-sources.mjs";
import { makePagesServer } from "../scripts/serve-pages.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), "qev-pages-")); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
for (const base of ["http://127.0.0.1:8090/", "https://robtandy.github.io/qev/", "https://example.org/nested/app/"]) {
  test(`all runtime asset families stay inside ${base}`, () => {
    for (const path of ["engine/qwasm.mjs", "engine/qwasm.wasm", `${KEVALA_ASSET_PATH}index.js`, `${KEVALA_ASSET_PATH}engine-worker.js`, "demo/pak0.pak", "src/app.js"])
      assert.equal(appURL(path, base), base + path);
  });
}
test("application asset resolver rejects roots, URL injection and traversal", () => {
  for (const path of ["", "/engine/qwasm.wasm", "../secret", "a/../../b", "./x", "a//x", "https://evil.test/x", "a\\x", "x?url=bad", "%2e%2e/x"])
    assert.throws(() => appURL(path), /application-relative/);
});
test("HTML and runtime entry points never require domain-root mounts", async () => {
  for (const name of ["public/index.html", "public/licenses.html"]) {
    const html = await readFile(resolve(root, name), "utf8");
    assert.doesNotMatch(html, /(?:href|src)=["']\/(?!\/)/);
  }
  for (const name of ["src/app.js", "src/engine.js", "src/demo.js"]) assert.doesNotMatch(await readFile(resolve(root, name), "utf8"), /(?:import|fetch)\(["']\//);
});
test("runtime exporter allowlists extensions and excludes hidden files, weights and diagnostics", async t => {
  const temp = await temporary(t), source = join(temp, "in"), dest = join(temp, "out"); await mkdir(join(source, "nested"), { recursive: true });
  for (const name of ["a.js", "runtime.wasm", ".env", "secret.pak", "model.kevala", "weights.safetensors", "capture.png", "trace.log", "nested/b.js"])
    await writeFile(join(source, name), name);
  await copyRuntimeTree(source, dest, [".js", ".wasm"]);
  assert.deepEqual((await readdir(dest)).sort(), ["a.js", "nested", "runtime.wasm"]);
  assert.deepEqual(await readdir(join(dest, "nested")), ["b.js"]);
  await symlink(join(source, ".env"), join(source, "leak.js"));
  await assert.rejects(copyRuntimeTree(source, dest, [".js"]), /symlink/);
  assert.deepEqual(PAGE_ENGINE_FILES, ["qwasm.mjs", "qwasm.wasm", "build.json", "QWASM-LICENSE.txt"]);
});
// Synthetic Wasm export table, not a runnable Quake engine or gameplay fixture.
function fakeExports(names) {
  const exp = [names.length, ...names.flatMap(n => [n.length, ...Buffer.from(n), 0, 0])];
  return Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, exp.length, ...exp, 10, 6, 1, 4, 0, 65, 0, 11]);
}
test("Pages rejects stale, embedded-asset and evaluation engines, including a mislabeled Wasm export", async t => {
  const temp = await temporary(t);
  for (const path of ENGINE_INPUTS) { const target = join(temp, path); await mkdir(dirname(target), { recursive: true }); await cp(resolve(root, path), target); }
  await mkdir(join(temp, "build/engine"), { recursive: true });
  const names = ["qev_snapshot", "qev_command", "qev_control_version", "qev_diagnostics"];
  await writeFile(join(temp, "build/engine/qwasm.wasm"), fakeExports(names));
  const good = { evaluationOnly: false, assetsEmbedded: false, sourceDigest: await engineSourceDigest(temp) };
  const metadata = async value => writeFile(join(temp, "build/engine/build.json"), JSON.stringify(value));
  await metadata(good); assert.deepEqual(await verifyPageEngine(temp), good);
  await writeFile(join(temp, "build/engine/qwasm.wasm"), fakeExports(names.filter(n => n !== "qev_diagnostics")));
  await assert.rejects(verifyPageEngine(temp), /Invalid/);
  await writeFile(join(temp, "build/engine/qwasm.wasm"), fakeExports(names));
  await metadata({ ...good, evaluationOnly: true }); await assert.rejects(verifyPageEngine(temp), /normal, asset-free/);
  await metadata({ ...good, assetsEmbedded: true }); await assert.rejects(verifyPageEngine(temp), /normal, asset-free/);
  await metadata({ ...good, sourceDigest: "0".repeat(64) }); await assert.rejects(verifyPageEngine(temp), /mismatch/);
  await metadata(good); await writeFile(join(temp, "build/engine/qwasm.wasm"), fakeExports([...names, "qev_evaluation"]));
  await assert.rejects(verifyPageEngine(temp), /instrumented/);
  await writeFile(join(temp, "build/engine/qwasm.wasm"), fakeExports(names));
  await writeFile(join(temp, "engine/qev_bridge.c"), "changed source"); await assert.rejects(verifyPageEngine(temp), /mismatch/);
});
test("preview really serves only the static /qev/ tree, with correct types and no root aliases", async t => {
  const temp = await temporary(t), site = join(temp, "site"); await mkdir(join(site, "engine"), { recursive: true });
  await writeFile(join(site, "index.html"), "qev"); await writeFile(join(site, "engine/qwasm.wasm"), "wasm"); await writeFile(join(temp, "private.txt"), "private");
  await symlink(join(temp, "private.txt"), join(site, "leak.txt"));
  const server = makePagesServer(site); await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const redirect = await fetch(url + "/qev", { redirect: "manual" }); assert.equal(redirect.status, 308); assert.equal(redirect.headers.get("location"), "/qev/");
  assert.equal(await (await fetch(url + "/qev/")).text(), "qev");
  for (const method of ["GET", "HEAD"]) {
    const r = await fetch(url + "/qev/engine/qwasm.wasm", { method }); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "application/wasm");
    assert.equal(await r.text(), method === "GET" ? "wasm" : ""); assert.equal(r.headers.get("cross-origin-embedder-policy"), null);
  }
  for (const path of ["/", "/engine/qwasm.wasm", "/qev/.env", "/qev/leak.txt", "/qev/src/%2e%2e%2f%2e%2e%2fprivate.txt", "/qev/%00bad", "/qev/engine/"])
    assert.ok([403, 404].includes((await fetch(url + path)).status), path);
  assert.equal((await fetch(url + "/qev/", { method: "POST" })).status, 405);
});
test("deployment supplies pinned GPL source downloads and uploads only the generated artifact", async () => {
  assert.equal(PAGE_SOURCES.length, 2);
  for (const source of PAGE_SOURCES) { assert.match(source.revision, /^[a-f0-9]{40}$/); assert.match(source.url, /^https:\/\/github.com\//); }
  const workflow = await readFile(resolve(root, ".github/workflows/pages.yml"), "utf8");
  assert.match(workflow, /path: build\/site/); assert.match(workflow, /npm ci --ignore-scripts/); assert.match(workflow, /npm run test:pages/);
  assert.doesNotMatch(workflow, /build:engine:evaluation|test:gameplay|pull_request_target/);
  for (const line of workflow.matchAll(/uses: (.+)/g)) assert.match(line[1], /^actions\/[\w-]+@[a-f0-9]{40} /);
});
