import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { CONTROLLER_POLICY, OBSERVATION_POLICY } from "../src/control.js";
const source = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("setup no longer includes the explanation question mark, label, preview or modal", () => {
  const html = source("../public/index.html");
  assert.doesNotMatch(html, /assistance-setting|assistance-help|help-button|data-help-|How it plays/);
  assert.doesNotMatch(source("../public/style.css"), /assistance-setting|help-button|help-preview|help-dialog|help-modal-open/);
  for (const id of ["map", "difficulty", "model", "backend", "auto", "pause", "step", "reset"]) assert.ok(html.includes(`id="${id}"`), id);
});

test("startup and game shortcuts have no dependency on the removed help widget", () => {
  const app = source("../src/app.js");
  assert.doesNotMatch(app, /AssistanceHelp|assistanceHelp|assistance-help/);
  assert.equal(existsSync(new URL("../src/assistance-help.js", import.meta.url)), false);
  assert.match(app, /event.code === "KeyP"/);
  assert.match(app, /event.code === "Escape"/);
  assert.match(app, /event.code === "KeyN"/);
});

test("removing the help control preserves controller disclosures in documentation and traces", () => {
  assert.match(source("../README.md"), /How it works/);
  assert.match(source("../README.md"), /control policy and perception limits/);
  assert.match(source("../src/app.js"), /observationPolicy: OBSERVATION_POLICY, controller: CONTROLLER_POLICY/);
  assert.match(CONTROLLER_POLICY, /full public tactic distribution/);
  assert.match(CONTROLLER_POLICY, /explicit look-up\/down/);
  assert.match(OBSERVATION_POLICY, /Not RGB\/audio recognition/);
});
