// Static /Qev/ smoke test; --url tests the deployed site, --model adds real Laya.
// Browser --mute-audio is verified BEFORE loading any application page.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makePagesServer } from "./serve-pages.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(url|model|commit)(?:=(.*))?$/.exec(arg);
  if (!match) throw new Error("Usage: browser-pages.mjs [--url=https://owner.github.io/Qev/] [--model] [--commit=sha]");
  return [match[1], match[2] ?? true];
}));
const url = new URL(options.url || "http://127.0.0.1:8092/Qev/");
if (!["http:", "https:"].includes(url.protocol) || !url.pathname.endsWith("/") || url.search || url.hash) throw new Error("Provide the app's http(s) URL with a trailing slash.");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout; let error;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (e) { error = e; } await sleep(100); }
  throw error || new Error("Timed out waiting for static-site browser state.");
}
let server;
if (!options.url) { server = makePagesServer(); await new Promise(r => server.listen(8092, "127.0.0.1", r)); }
await mkdir(resolve(root, "build/pages-browser-profile"), { recursive: true });
const chrome = spawn(process.env.CHROME_PATH || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), [
  "--headless=new", "--enable-automation", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--enable-unsafe-webgpu", "--autoplay-policy=document-user-activation-required",
  `--user-data-dir=${root}/build/pages-browser-profile`, "--remote-debugging-port=9232", "about:blank",
], { stdio: "ignore" });
let ws, evaluate; const errors = [], requests = [];
try {
  chrome.on("error", error => errors.push({ launch: error.message }));
  const page = await until(async () => (await (await fetch("http://127.0.0.1:9232/json/list")).json()).find(p => p.type === "page"));
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, reject) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) { clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails);
    else if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome did not answer ${method} within 30 seconds.`)); }, 30000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener("close", () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Chrome disconnected.")); } pending.clear(); });
  evaluate = async expression => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  assert.ok((await call("Browser.getBrowserCommandLine")).arguments.includes("--mute-audio"), "Mute browser output before loading the site");
  console.log("PASS static-site browser audio is muted (--mute-audio)");
  await call("Runtime.enable"); await call("Page.enable"); await call("Network.enable"); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: url.href });
  await until(() => evaluate("!!window.qev?.engine || !!document.querySelector('#error')?.textContent"), 120000);
  assert.equal(await evaluate("!!qev.engine"), true, await evaluate("document.querySelector('#error').textContent"));
  const info = await evaluate(`(async()=>{const meta=await(await fetch(new URL('deployment.json',location.href))).json(),s=qev.engine.snapshot();
    return {meta,snapshot:s,model:!!qev.model,logo:document.querySelector('.brand-logo').currentSrc,
      css:[...document.styleSheets].some(s=>s.href?.endsWith('/style.css')),
      normal:typeof qev.engine.module._qev_evaluation==='undefined',control:qev.engine.module._qev_control_version(),screen:qev.engine.module._qev_screen_version()};})()`);
  assert.equal(info.snapshot.ready, true); assert.equal(info.snapshot.paused, true); assert.equal(info.snapshot.map, "lq_e0m6"); assert.equal(info.snapshot.difficulty, 2);
  assert.equal(info.normal, true); assert.equal(info.control, 6); assert.equal(info.screen, 3); assert.equal(info.model, false); assert.equal(info.css, true);
  assert.equal(new URL(info.logo).pathname, url.pathname + "brand/qev-logo.svg");
  const expected = options.commit || process.env.GITHUB_SHA;
  if (expected) assert.equal(info.meta.commit, expected);
  if (options.url) assert.equal(info.meta.dirty, false, "Publish committed source, not a modified working tree");
  assert.ok(!requests.some(r => r.startsWith("https://huggingface.co/")), "Startup must not download a model");
  console.log("PASS static project-path startup: CSS/logo, verified demo, normal engine, map 6/Hard, stopped without model downloads");
  for (const path of ["licenses.html", "demo/NOTICE.txt", "engine/QWASM-LICENSE.txt", "vendor/kevala/LICENSE", "licenses/SDL2.txt", "licenses/EMSCRIPTEN.txt",
    "sources/manifest.json", "sources/qev-engine.tar.gz", "sources/librequake-code.tar.gz", "sources/pop-generator.tar.gz"]) {
    const status = await evaluate(`(async()=>{const r=await fetch(new URL(${JSON.stringify(path)},location.href),{method:'HEAD'});return r.status;})()`);
    assert.equal(status, 200, path);
  }
  console.log("PASS license notices and corresponding-source downloads at the project path");
  assert.equal(await evaluate("(async()=>{const s=qev.engine.snapshot();await qev.engine.frame();const a=qev.engine.snapshot();return a.paused&&a.tick===s.tick+1})()"), true);
  console.log("PASS native engine advances exactly one requested tick and pauses");
  let decision = null, model = null;
  if (options.model) {
    await evaluate("document.querySelector('#model').value='laya';document.querySelector('#model').dispatchEvent(new Event('change',{bubbles:true}))");
    let progress;
    await until(async () => {
      const state = await evaluate("({ready:!!qev.model&&!document.querySelector('#step').disabled,status:document.querySelector('#model-status').textContent,error:document.querySelector('#error').textContent})");
      if (state.status !== progress) { progress = state.status; console.log("Model:", progress); }
      if (state.error) throw new Error(state.error);
      return state.ready;
    }, 300000);
    const point = await evaluate("(()=>{const r=document.querySelector('#step').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    await until(() => evaluate("qev.agent.history.some(r=>['executed','interrupted'].includes(r.status)) && !document.querySelector('#step').disabled"), 180000);
    decision = await evaluate("qev.agent.history.findLast(r=>['executed','interrupted'].includes(r.status))");
    model = await evaluate("qev.model.info");
    assert.equal(decision.sampling.method, "categorical-v1");
    assert.ok(decision.requests.every(item => item.state.includes("Owned weapons:")));
    assert.ok(decision.execution.ticksApplied > 0 && decision.execution.ticksApplied <= decision.selected.params.ticks);
    assert.equal(await evaluate("qev.engine.snapshot().paused"), true);
    console.log(`PASS real Laya ${model.backend} worker loads and executes a sampled frozen Step at the project path`);
  }
  const outside = requests.filter(r => { const v = new URL(r); return v.origin === url.origin && !v.pathname.startsWith(url.pathname); });
  assert.deepEqual(outside, [], "No domain-root asset leaks"); assert.deepEqual(errors, []);
  await writeFile(resolve(root, `build/pages-${options.url ? "live" : "local"}.json`), JSON.stringify({ url: url.href, commit: info.meta.commit, model, decision, requests, errors }, null, 2));
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(resolve(root, `build/pages-${options.url ? "live" : "local"}.png`), Buffer.from(screenshot.data, "base64"));
  console.log(`PASS static-site verification complete: ${url.href} (${info.meta.commit})`);
} catch (error) {
  if (evaluate) console.error("Static-site diagnostics:", await evaluate("({error:document.querySelector('#error')?.textContent,model:document.querySelector('#model-status')?.textContent,status:document.querySelector('#status')?.textContent})").catch(e => e.message));
  throw error;
} finally {
  if (evaluate) await evaluate("window.qev?.pause()").catch(() => {});
  ws?.close(); chrome.kill();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}
