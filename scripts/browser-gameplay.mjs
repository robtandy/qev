// Sustained real-model gameplay, not a mocked command/smoke test.
// Requires: node scripts/build-engine.mjs --evaluation
// Aggregate motion instrumentation exists ONLY in that separate test build.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { makeServer, root } from "./serve.mjs";
import { GAMEPLAY_BAR, gradeGameplay } from "./gameplay-report.mjs";

const opts = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
  if (!match) throw new Error(`Invalid option: ${arg}`);
  return [match[1], match[2] ?? true];
}));
for (const key of Object.keys(opts)) if (!["model", "backend", "map", "seconds", "runs", "label", "report-only", "driver"].includes(key)) throw new Error(`Unknown option: ${key}`);
const model = opts.model ?? "laya", backend = opts.backend ?? "auto", map = opts.map ?? "lq_e0m6";
const seconds = Number(opts.seconds ?? 60), runs = Number(opts.runs ?? 3), label = opts.label ?? `${model}-${Date.now()}`;
if (!["laya", "kev-0.8b"].includes(model) || !["auto", "wasm"].includes(backend) || !/^[a-z0-9_-]{1,40}$/i.test(map) ||
    !/^[a-z0-9_-]{1,80}$/i.test(label) || !(seconds >= 5 && seconds <= 600) || !Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error("Invalid gameplay configuration");
const output = resolve(root, "build/gameplay", label); await mkdir(output, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 45000) {
  const end = Date.now() + ms; let error;
  while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch (e) { error = e; } await sleep(100); }
  throw error || new Error("Timed out waiting for gameplay");
}
const server = makeServer(root, { evaluationEngine: true });
await new Promise(r => server.listen(8091, "127.0.0.1", r));
const chrome = spawn(process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--enable-automation", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--enable-unsafe-webgpu", "--autoplay-policy=no-user-gesture-required",
  `--user-data-dir=${root}/build/browser-profile`, "--remote-debugging-port=9226", "about:blank",
], { stdio: "ignore" });
let ws, evaluate; const reports = [], exceptions = [];
try {
  const page = await until(async () => (await (await fetch("http://127.0.0.1:9226/json/list")).json()).find(p => p.type === "page"));
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) { const job = pending.get(msg.id); pending.delete(msg.id); msg.error ? job.reject(new Error(JSON.stringify(msg.error))) : job.resolve(msg.result); }
    else if (msg.method === "Runtime.exceptionThrown") exceptions.push(msg.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  assert.ok((await call("Browser.getBrowserCommandLine")).arguments.includes("--mute-audio"), "Host audio MUST be muted");
  console.log("PASS gameplay browser audio muted");
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: "http://127.0.0.1:8091/" });
  await until(() => evaluate("!!window.qev?.engine"));
  assert.equal(await evaluate("(async()=>{const b=await(await fetch('/engine/build.json')).json();return b.evaluationOnly===true&&typeof qev.engine.module._qev_evaluation==='function'})()"), true);
  await evaluate(`document.querySelector('#backend').value=${JSON.stringify(backend)};document.querySelector('#backend').dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('#model').value=${JSON.stringify(model)};document.querySelector('#model').dispatchEvent(new Event('change',{bubbles:true}));`);
  await until(() => evaluate("!!qev.model || !document.querySelector('#error').hidden"), 600000);
  assert.equal(await evaluate("!!qev.model"), true, await evaluate("document.querySelector('#error').textContent"));
  const info = await evaluate("qev.model.info"); console.log("REAL MODEL", JSON.stringify(info));
  if (opts.driver) await evaluate(await readFile(resolve(root, String(opts.driver)), "utf8"));
  for (let run = 1; run <= runs; run++) {
    await evaluate(`(async()=>{qev.pause();qev.agent.invalidate();await qev.engine.loadMap(${JSON.stringify(map)},2);qev.engine.speed(1);
      document.querySelector('#map').value=${JSON.stringify(map)};document.querySelector('#difficulty').value='2';
      qev.respawner.enabled=false;window.gameplayRun={records:new Map(),onChange:qev.agent.onChange};
      qev.agent.onChange=()=>{const r=qev.agent.current;if(r)gameplayRun.records.set(r.id,r);gameplayRun.onChange();};
      gameplayRun.metrics=()=>{const m=qev.engine.module;return JSON.parse(m.UTF8ToString(m._qev_evaluation()));};})()`);
    const start = await evaluate("qev.engine.snapshot()"), samples = [];
    let longestNoProgress = 0, lastProgress = Date.now(), lastDistance = 0, lastKills = start.player.kills;
    let lastShot = -1;
    const screenshot = async name => {
      const image = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(resolve(output, `run-${run}-${name}.png`), Buffer.from(image.data, "base64"));
    };
    await screenshot("start");
    if (opts.driver) await evaluate("window.startGameplayDriver()");
    else {
      await until(() => evaluate("!document.querySelector('#auto').disabled"));
      await evaluate("document.querySelector('#auto').click()");
    }
    const started = Date.now();
    while (Date.now() - started < seconds * 1000) {
      await sleep(250);
      const sample = await evaluate(`(()=>{const s=qev.engine.snapshot(),r=window.gameplayDriver?.current||qev.agent.current;return{tick:s.tick,alive:s.alive,paused:s.paused,completed:s.completed,
        health:s.player?.health,kills:s.player?.kills,shells:s.player?.shells,weapon:s.player?.weapon,viewRecovery:s.viewRecovery,metrics:gameplayRun.metrics(),
        decision:r?.id,status:r?.status,action:r?.selected?.label,error:r?.error,ms:r?.ms}})()`);
      sample.wallSeconds = (Date.now() - started) / 1000; samples.push(sample);
      if (sample.metrics.distance - lastDistance >= 16 || sample.kills > lastKills) { lastProgress = Date.now(); lastDistance = sample.metrics.distance; lastKills = sample.kills; }
      longestNoProgress = Math.max(longestNoProgress, (Date.now() - lastProgress) / 1000);
      const time = Math.floor(sample.wallSeconds / 10) * 10;
      if (time > lastShot) { lastShot = time; await screenshot(`${time}s`); console.log(`RUN ${run}`, JSON.stringify(sample)); }
      if (sample.paused || !sample.alive || sample.completed) break;
    }
    if (opts.driver) await evaluate("window.stopGameplayDriver()"); else await evaluate("qev.pause()");
    await until(() => evaluate("!qev.agent.busy && !window.gameplayDriver?.busy"), 120000);
    const end = await evaluate("qev.engine.snapshot()"), metrics = await evaluate("gameplayRun.metrics()");
    const records = await evaluate("window.gameplayDriver ? [...gameplayDriver.records.values()] : [...gameplayRun.records.values()]");
    const applied = records.filter(r => r.appliedAt);
    const grade = gradeGameplay({ start, end, metrics, longestNoProgress, records });
    const summary = { run, model, backend: info.backend, map, difficulty: 2, wallSeconds: (Date.now() - started) / 1000,
      alive: end.alive, completed: end.completed, kills: grade.kills, health: end.player.health, metrics, longestNoProgress,
      decisions: records.length, applied: applied.length,
      samplingMethod: "categorical-v1",
      sampledTactics: applied.filter(r => r.sampling?.heads.action.method === "categorical-v1").length,
      nonTopTactics: applied.filter(r => r.selected?.optionId !== r.responses?.[0]?.answers?.action?.choice).length,
      nonTopBindings: applied.flatMap(r => Object.entries(r.sampling?.heads ?? {}).filter(([question, h]) =>
        question !== "action" && h.method === "categorical-v1" && h.optionId !== h.sdkChoice)).length,
      viewRecoveryTicks: end.viewRecovery.ticks - start.viewRecovery.ticks,
      engagements: applied.filter(r => r.selected?.id === "engage").length,
      meleeApproachTicks: applied.reduce((sum, r) => sum + (r.execution?.meleeApproachTicks ?? 0), 0),
      choices: [...new Set(applied.map(r => r.selected?.label))],
      rejected: records.filter(r => ["error", "discarded", "rejected"].includes(r.status)).map(r => ({ status: r.status, error: r.error })),
      passed: grade.passed, failures: grade.failures };
    const report = { evaluationOnly: true, prototype: !!opts.driver, acceptance: GAMEPLAY_BAR, caveat: "Independent real-model episode, not matched replay or a general skill/survival estimate. Motion metrics are test-only and never supplied to the model; kills are the game's scoreboard count, not damage inferred from shots.",
      summary, start, end, samples, records };
    await writeFile(resolve(output, `run-${run}.json`), JSON.stringify(report, null, 2)); await screenshot("end");
    reports.push(summary); console.log("RESULT", JSON.stringify(summary));
    await evaluate("qev.agent.onChange=gameplayRun.onChange");
  }
  assert.deepEqual(exceptions, [], "No uncaught browser errors");
  await writeFile(resolve(output, "summary.json"), JSON.stringify({ prototype: !!opts.driver, acceptance: GAMEPLAY_BAR, model: info, reports }, null, 2));
  if (!opts["report-only"]) assert.ok(reports.every(r => r.passed), "Sustained gameplay failed; see actual kills/movement/stalls in the report. Command execution alone is not a pass.");
} catch (error) {
  console.error(error);
  if (evaluate) console.error("DIAGNOSTICS", await evaluate("({error:document.querySelector('#error')?.textContent,status:document.querySelector('#status')?.textContent,model:document.querySelector('#model-status')?.textContent})").catch(() => null));
  process.exitCode = 1;
} finally {
  ws?.close(); chrome.kill("SIGTERM"); server.closeAllConnections(); await new Promise(r => server.close(r)); await sleep(1000);
}
