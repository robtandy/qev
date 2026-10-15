import { DEMO_SETUP_HELP } from "./demo-manifest.js";
import { appURL } from "./paths.js";

// Qwasm's Sys_Error prints to stdout then exits; this does not always call onAbort.
export function engineErrorFromLog(message) {
  const match = String(message).match(/(?:^|\n)\s*(?:Error|Host_Error):\s*([^\r\n]+)/i);
  if (!match) return null;
  const hint = /registered version.*modified games/i.test(match[1]) ? ` The complete LibreQuake demo is required. ${DEMO_SETUP_HELP}` : "";
  return new Error(`Quake stopped: ${match[1]}${hint}`);
}

export const DIFFICULTIES = ["Easy", "Normal", "Hard", "Nightmare"];
export const DEFAULT_DIFFICULTY = 2;
export function validateDifficulty(value) {
  if (!Number.isInteger(value) || value < 0 || value >= DIFFICULTIES.length) throw new Error("Invalid difficulty. Choose Easy, Normal, Hard, or Nightmare.");
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CONFIG = `
bind w +forward
bind s +back
bind a +moveleft
bind d +moveright
bind SPACE +jump
bind MOUSE1 +attack
bind 1 "impulse 1"
bind 2 "impulse 2"
bind 3 "impulse 3"
bind 4 "impulse 4"
bind 5 "impulse 5"
bind 6 "impulse 6"
bind 7 "impulse 7"
bind 8 "impulse 8"
+mlook
viewsize 100
fov 90
sensitivity 3
cl_bob 0
`;

export class Engine {
  static async start({ canvas, data, map, difficulty = DEFAULT_DIFFICULTY, onLog = () => {} }) {
    validateDifficulty(difficulty);
    if (!data.maps.includes(map)) throw new Error("The requested map is not in the LibreQuake demo.");
    let factory;
    try { factory = (await import(appURL("engine/qwasm.mjs"))).default; }
    catch { throw new Error("Engine build not found. Run npm run setup:engine, then npm run build:engine."); }
    let fault = null;
    const report = (message) => { fault ||= engineErrorFromLog(message); onLog(message); };
    const module = await factory({
      canvas, noInitialRun: true, keyboardListeningElement: canvas,
      print: report, printErr: report, onAbort: (message) => { fault ||= new Error(`Quake stopped: ${message}`); },
      locateFile: (file) => appURL(`engine/${file}`),
    });
    if (["_qev_auto", "_qev_command", "_qev_live_command", "_qev_new_game", "_qev_screen_version", "_qev_control_version", "_qev_audio_access"].some(name => typeof module[name] !== "function") || module._qev_screen_version() !== 3 || module._qev_control_version() !== 7) throw new Error("Engine build is out of date. Run npm run build:engine, then reload.");
    module.hideConsole = () => {};
    module.showConsole = () => onLog(fault ? "Quake stopped. Correct the error above, then reload the page." : "Quake console opened. Use the game canvas when playing manually.");
    module.captureMouse = () => {}; // pointer lock is only requested by an explicit canvas click
    module.setGamma = () => {};
    module.FS.mkdir("/id1");
    for (const file of data.files) module.FS.writeFile(`/id1/${file.name}`, file.bytes);
    module.FS.writeFile("/id1/autoexec.cfg", CONFIG);
    const engine = new Engine(module, () => fault);
    try {
      module.callMain(["-heapsize", "65536", "-winsize", "640", "480", "+skill", String(difficulty), "+map", map]);
      // Initialize SDL audio, but silence it before yielding—even when autoplay is allowed.
      // Bootstrapping still advances until the stopped world is ready.
      engine.pause();
      engine.watchAudio();
    } catch (error) { throw fault || error; }
    await engine.waitFor((s) => s.ready && s.map === map && s.difficulty === difficulty, 30_000);
    engine.pause();
    return engine;
  }
  constructor(module, getFault = () => null) { this.module = module; this.getFault = getFault; }
  // SDL 2.30.9 exposes its Web Audio context on Module.SDL2. Call from a user
  // gesture, before model inference awaits. This never starts/unpauses the game.
  watchAudio() {
    const context = this.module.SDL2?.audioContext;
    if (context && this.audioContext !== context) {
      this.audioContext?.removeEventListener?.("statechange", this.audioChanged);
      this.audioContext = context;
      this.audioChanged = () => this.module._qev_audio_access?.(context.state === "running" ? 1 : 0);
      context.addEventListener?.("statechange", this.audioChanged);
    }
    this.module._qev_audio_access?.(context?.state === "running" ? 1 : 0);
  }
  async resumeAudio() {
    const { audioContext: context, audio } = this.module.SDL2 || {};
    if (!context || !audio?.scriptProcessorNode || context.state === "closed") throw new Error("Game audio is unavailable. Check browser sound support and reload the page.");
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") throw new Error("The browser kept game audio suspended.");
    this.watchAudio();
    return true;
  }
  snapshot() {
    const fault = this.getFault();
    if (fault) throw fault;
    return JSON.parse(this.module.UTF8ToString(this.module._qev_snapshot()));
  }
  startAuto() {
    const session = this.module._qev_auto();
    if (!session) throw new Error("Pause a live game before starting real-time Auto.");
    return session;
  }
  commandValues(p) {
    const integers = [p.epoch, p.tick, p.ref, p.weapon, p.ticks];
    const values = [p.epoch, p.tick, p.ref, p.forward, p.side, p.up, p.yawRate, p.pitchRate, p.fire ? 1 : 0, p.jump ? 1 : 0, p.weapon, p.ticks, p.meleeApproach ? 1 : 0];
    if (integers.some(v => !Number.isSafeInteger(v) || v < 0 || v > 2147483647) ||
        values.some(v => !Number.isFinite(v)) || typeof p.fire !== "boolean" || typeof p.jump !== "boolean" ||
        (p.meleeApproach !== undefined && typeof p.meleeApproach !== "boolean")) throw new Error("Invalid action parameters.");
    return values;
  }
  applyLive(p, session) {
    if (!Number.isSafeInteger(session) || session < 1 || session > 2147483647) throw new Error("Invalid real-time session.");
    const values = this.commandValues(p);
    values.splice(2, 0, session);
    return !!this.module._qev_live_command(...values);
  }
  pause() { this.module._qev_pause(); }
  play() {
    if (!this.module._qev_play()) throw new Error("The single-player game is not ready.");
  }
  speed(value) {
    if (!this.module._qev_speed(value)) throw new Error("Invalid simulation speed.");
  }
  async waitFor(predicate, timeout = 15_000) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      const snapshot = this.snapshot();
      if (predicate(snapshot)) return snapshot;
      await sleep(16);
    }
    this.pause();
    throw new Error("Quake did not finish the requested operation. Check the engine log.");
  }
  async act(p) {
    if (!this.module._qev_command(...this.commandValues(p))) throw new Error("Action rejected: the world, chosen visible contact, or structural validation changed. Score again.");
    return this.waitFor((s) => s.epoch !== p.epoch || !s.ready || s.remaining === 0);
  }
  async frame() {
    const before = this.snapshot();
    if (!this.module._qev_step_frame(before.epoch, before.tick)) throw new Error("Pause a live game before stepping a frame.");
    return this.waitFor((s) => s.epoch !== before.epoch || s.remaining === 0);
  }
  async loadMap(map, difficulty) {
    if (typeof map !== "string" || !/^[\w-]{1,40}$/.test(map)) throw new Error("Invalid map name.");
    const before = this.snapshot();
    const level = validateDifficulty(difficulty === undefined ? before.difficulty ?? DEFAULT_DIFFICULTY : difficulty);
    if (!this.module.ccall("qev_new_game", "number", ["string", "number"], [map, level])) throw new Error("Could not start the map.");
    return this.waitFor((s) => s.ready && s.epoch !== before.epoch && s.map === map && s.difficulty === level && s.paused && !s.remaining, 30_000);
  }
}
