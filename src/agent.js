import { prepareDecision, rankDecision, resolveSelection, DEFAULT_DECISION_FORMAT, validateDecisionFormat, MAX_DECISION_AGE_TICKS, MAX_DECISION_AGE_MS } from "./decisions.js";
import { DEFAULT_PRIORITY_ORDER, validatePriorityOrder } from "./objective.js";
import { ScreenMemory } from "./screen.js";
import { ObservationMemory } from "./perception.js";
import { automaticPlan, bindAutomatic } from "./automatic.js";

// Actual camera-cleanup ticks observed in this window, including neutral live
// time after a target lease. Not movement, attack ticks, or extra Step frames.
function recoveryTicks(before, after) {
  const start = before?.viewRecovery?.ticks, end = after?.viewRecovery?.ticks;
  return before?.epoch === after?.epoch && Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start ? end - start : null;
}

/** DOM-free lifecycle: frozen score/step inspection, or single-flight real-time decisions. */
export class Agent {
  #priorityOrder;
  #random;
  constructor({ engine, getModel, onChange = () => {}, decisionFormat = DEFAULT_DECISION_FORMAT, priorityOrder = DEFAULT_PRIORITY_ORDER, random = Math.random }) {
    // Fixed for this controller's lifetime: an in-flight response cannot change interpretation.
    Object.defineProperty(this, "decisionFormat", { value: validateDecisionFormat(decisionFormat), enumerable: true });
    this.#priorityOrder = validatePriorityOrder(priorityOrder);
    if (typeof random !== "function") throw new Error("The sampling source must be a function.");
    this.#random = random; // Injectable for deterministic tests, fixed for this controller's lifetime.
    this.engine = engine;
    this.getModel = getModel;
    this.onChange = onChange;
    this.generation = 0;
    this.sequence = 0;
    this.current = null;
    this.history = [];
    this.inflight = null;
    this.executing = false;
    this.memory = null;
    this.observations = new ObservationMemory();
    this.screenMemory = new ScreenMemory();
    this.liveSession = null;
    this.liveMap = null;
    this.active = null;
    this.scoredModel = null;
  }
  get busy() { return !!this.inflight || this.executing; }
  get priorityOrder() { return this.#priorityOrder; }
  setPriorities(order) {
    const next = validatePriorityOrder(order);
    if (next.every((id, i) => id === this.#priorityOrder[i])) return false;
    this.#priorityOrder = next;
    // Invalidate even a frozen score: its observation may match, but its prompt no longer does.
    // Historical requests/objectives retain the independent order captured when scored.
    this.invalidate();
    return true;
  }
  invalidate() {
    this.generation++;
    this.liveSession = null;
    this.engine.pause();
    if (this.active) this.finishLive(this.engine.snapshot(), "Controller invalidated.");
    if (this.current && ["scoring", "scored", "stepping"].includes(this.current.status)) this.current.status = "cancelled";
    this.current = null;
    this.scoredModel = null;
    // Stopping/changing priorities does not erase legitimate observations. Both
    // memories reset themselves on a new world/epoch, never use hidden locations.
    this.onChange();
  }
  pause() {
    if (this.liveSession !== null) {
      this.generation++; // No late real-time response may resume a stopped controller.
      this.liveSession = null;
      if (this.current?.mode === "realtime" && ["scoring", "scored"].includes(this.current.status)) this.current.status = "cancelled";
    }
    this.engine.pause();
    if (this.active) this.finishLive(this.engine.snapshot(), "Interrupted by Pause.");
    // A frozen inspection score can still complete, but never executes by itself.
    this.onChange();
  }
  startLive() {
    if (this.busy) throw new Error("Wait for the current score or step to finish.");
    if (!this.getModel()) throw new Error("Load a decision model first.");
    this.invalidate();
    this.liveSession = this.engine.startAuto();
    this.liveMap = this.engine.snapshot().map || "";
    this.onChange();
  }
  observeObservation(now) {
    this.screenMemory.observe(now);
    this.observations.observe(now, this.screenMemory.describe(now));
    if (this.memory && now.epoch !== this.memory.epoch) this.memory = null;
  }
  liveValid(now, record) {
    return now.ready && now.alive && !now.completed && !now.paused && now.owned &&
      now.epoch === record.before.epoch && now.controlSession === this.liveSession &&
      now.controlSession === record.before.controlSession && now.tick >= record.before.tick &&
      now.tick - record.before.tick <= MAX_DECISION_AGE_TICKS && performance.now() - record.startedMono <= MAX_DECISION_AGE_MS;
  }
  async score({ realtime = false } = {}) {
    if (this.busy) throw new Error("Wait for the current score or step to finish.");
    const model = this.getModel();
    if (!model) throw new Error("Load a decision model first.");
    if (!realtime) {
      if (this.liveSession !== null) throw new Error("Pause Auto before scoring for inspection.");
      this.engine.pause();
    }
    const before = this.engine.snapshot();
    if (!before.ready || !before.alive || before.completed) throw new Error("Start a live single-player game first.");
    if (realtime && (this.liveSession === null || before.paused || !before.owned || before.controlSession !== this.liveSession)) throw new Error("Start real-time Auto before scoring a moving world.");
    this.observeObservation(before);
    const holding = this.active && before.actionTicksLeft > 0 && before.actionSerial === this.active.actionSerial && before.epoch === this.active.appliedAt.epoch;
    const heldAction = holding ? this.active.selected.id : null; // Frame-local target IDs would be misleading in a newer view.
    const visual = this.screenMemory.describe(before);
    const prepared = prepareDecision(before, this.observations.describe(before, visual), {
      realtime, heldAction, decisionFormat: this.decisionFormat, priorityOrder: this.priorityOrder, visual });
    if (!prepared.eligible.length) throw new Error("No valid actions are available.");
    const record = {
      id: ++this.sequence, status: "scoring", mode: realtime ? "realtime" : "inspection", generation: this.generation,
      model: structuredClone(model.info ?? {}), before: structuredClone(before), ...prepared,
      responses: null, ranking: [], selectedIndex: null, sampling: null, startedAt: new Date().toISOString(),
      startedMono: performance.now(), ms: null, appliedAt: null, after: null, error: null,
    };
    this.current = record;
    this.history.push(record);
    if (this.history.length > 50) this.history.shift();
    const job = { generation: this.generation, record, model };
    this.inflight = job;
    this.onChange();
    try {
      const responses = await model.decideMany(record.requests);
      record.ms = performance.now() - record.startedMono;
      record.responses = responses; // Untouched response, including raw probabilities and timing.
      const now = this.engine.snapshot();
      record.checkedAt = structuredClone(now);
      const valid = realtime ? this.liveValid(now, record) : now.ready && now.epoch === before.epoch && now.tick === before.tick && now.paused && now.alive && !now.completed;
      if (job.generation !== this.generation || model !== this.getModel() || !valid) {
        record.status = "discarded";
        record.error = "The controller, world, or decision age changed; this response cannot be applied.";
        return null;
      }
      record.ranking = rankDecision(record);
      record.warnings = model.info?.arch === "laya" && responses.some(r => r.usage?.input_tokens >= 512)
        ? ["Laya reached its 512-token input limit; some text may have been truncated. No action applied."] : [];
      if (record.warnings.length) throw new Error(record.warnings[0]);
      record.selected = resolveSelection(record, { random: this.#random });
      record.selectedAtScore = structuredClone(record.selected);
      record.status = "scored";
      this.scoredModel = model;
      return record;
    } catch (error) {
      record.ms = performance.now() - record.startedMono;
      record.error = error?.message || String(error);
      record.status = job.generation === this.generation ? "error" : "discarded";
      if (job.generation === this.generation) throw error;
      return null;
    } finally {
      if (this.inflight === job) this.inflight = null;
      this.onChange();
    }
  }
  applyLive() {
    const record = this.current;
    if (this.busy || record?.status !== "scored" || record.mode !== "realtime") throw new Error("Score a real-time observation first.");
    const now = this.engine.snapshot();
    if (record.generation !== this.generation || this.scoredModel !== this.getModel() || !this.liveValid(now, record)) {
      record.status = "discarded";
      record.error = "Real-time decision is no longer fresh or owned by this controller.";
      this.onChange();
      return false;
    }
    record.checkedAt = structuredClone(now);
    record.automaticAtApply = automaticPlan(now);
    let choice;
    try { choice = bindAutomatic(record.selected, record.automaticAtApply); }
    catch (error) {
      record.status = "rejected"; record.error = error.message; this.onChange(); return false;
    }
    record.selected = choice;
    this.observeObservation(now);
    // The model chose the tactic. Approved nearest-visible/strongest-loaded
    // bindings use the fresh application snapshot; no action is substituted.
    if (!this.engine.applyLive(choice.params, this.liveSession)) {
      record.status = "rejected";
      record.error = "The chosen visible contact or structural validation changed before application.";
      this.onChange();
      return false;
    }
    this.finishLive(now, "Replaced by a newer model decision.");
    record.appliedAt = structuredClone(now);
    record.actionSerial = this.engine.snapshot().actionSerial;
    record.ageTicksAtApply = now.tick - record.before.tick;
    record.ageMsAtApply = performance.now() - record.startedMono;
    record.status = "acting";
    this.active = record;
    this.onChange();
    return true;
  }
  observeLive(now) {
    this.observeObservation(now);
    let changed = false, resumed = false;
    if (this.active && (now.epoch !== this.active.appliedAt.epoch || now.actionSerial !== this.active.actionSerial || !now.actionTicksLeft || now.paused || !now.alive || now.completed)) {
      this.finishLive(now, "Action ended or the world changed.");
      changed = true;
    }
    // An in-level teleporter is navigation, not success or a request to stop. Start a NEW
    // ownership session with neutral input; never carry an old command/result across it.
    if (this.liveSession !== null && now.ready && now.alive && !now.completed && now.paused &&
        now.stopReason === "Player teleported." && (now.map || "") === this.liveMap) {
      this.generation++;
      if (this.current && ["scoring", "scored"].includes(this.current.status)) this.current.status = "cancelled";
      this.liveSession = this.engine.startAuto();
      resumed = true;
    }
    if (changed || resumed) this.onChange();
    return resumed;
  }
  finishLive(after, reason) {
    const record = this.active;
    if (!record) return;
    this.active = null;
    record.after = structuredClone(after);
    record.execution = {
      ticksApplied: after.actionSerial === record.actionSerial ? after.actionTicks : null,
      weaponPresses: after.actionSerial === record.actionSerial ? after.weaponPresses ?? null : null,
      meleeApproachTicks: after.actionSerial === record.actionSerial ? after.meleeApproachTicks ?? null : null,
      viewRecoveryTicks: recoveryTicks(record.appliedAt, after),
      // This observation may be later than lease expiry; do not label the whole window active.
      observedEndTick: after.tick,
      stopReason: after.stopReason || reason,
    };
    record.status = after.epoch !== record.appliedAt.epoch || after.paused ? "interrupted" :
      after.actionTicksLeft > 0 ? "replaced" : record.execution.ticksApplied === record.selected.params.ticks ? "executed" : "interrupted";
    this.remember(record, record.appliedAt, after);
  }
  remember(record, before, after) {
    if (after.epoch !== before.epoch || !after.player) return;
    const choice = record.selected;
    const ticks = record.execution?.ticksApplied ?? after.actionTicks ?? after.tick - before.tick;
    if (!(ticks > 0)) return;
    this.observeObservation(after);
    this.observations.outcome(choice, before, after, ticks);
    record.memoryAfter = this.observations.describe(after, this.screenMemory.describe(after));
    this.memory = { epoch: after.epoch, label: choice.label, realtime: record.mode === "realtime",
      damage: Math.max(0, before.player.health - after.player.health), ammoChange: after.player.ammo - before.player.ammo };
  }
  async step() {
    if (this.busy) throw new Error("Wait for the current score or step to finish.");
    const record = this.current;
    if (!record || record.status !== "scored" || record.mode !== "inspection") throw new Error("Score the current paused observation first.");
    const now = this.engine.snapshot();
    if (!now.paused || !now.alive || now.completed || now.epoch !== record.before.epoch || now.tick !== record.before.tick || record.generation !== this.generation || this.scoredModel !== this.getModel()) {
      record.status = "discarded";
      this.onChange();
      throw new Error("The world changed. Score a fresh observation.");
    }
    if (!record.selected?.allowed) throw new Error("The selected action is invalid.");
    this.executing = true;
    record.status = "stepping";
    const generation = this.generation;
    this.onChange();
    try {
      record.automaticAtApply = automaticPlan(now);
      record.selected = bindAutomatic(record.selected, record.automaticAtApply);
      const choice = record.selected;
      const after = await this.engine.act(choice.params);
      record.after = structuredClone(after);
      record.execution = { ticksApplied: after.actionTicks ?? after.tick - record.before.tick, weaponPresses: after.weaponPresses ?? null, meleeApproachTicks: after.meleeApproachTicks ?? null,
        viewRecoveryTicks: recoveryTicks(record.before, after), observedEndTick: after.tick, stopReason: after.stopReason };
      record.status = generation === this.generation && after.epoch === record.before.epoch && after.tick - record.before.tick === choice.params.ticks ? "executed" : "interrupted";
      if (generation === this.generation) this.remember(record, record.before, after);
      return after;
    } catch (error) {
      record.error = error?.message || String(error);
      record.status = "error";
      this.engine.pause();
      throw error;
    } finally {
      this.executing = false;
      this.onChange();
    }
  }
}
