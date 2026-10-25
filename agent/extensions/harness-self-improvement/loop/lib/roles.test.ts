#!/usr/bin/env bun
/**
 * Unit tests for Step 11 role-model resolution (loop/lib/roles.ts):
 * resolveRoleModels (absent → session model; overrides honored) and
 * resolveIterationMode (explicit flag > post-targeted-confirmation >
 * auto-switch > config default).
 *
 *   bun test loop/lib/roles.test.ts
 */
import {describe, expect, test} from "bun:test";
import {resolveIterationMode, resolveRoleModels, type PreviousIterationModeInput} from "./roles.ts";

const SESSION = "ozon-real/AgentLLM-big";

describe("resolveRoleModels", () => {
  test("all roles absent → every role resolves to the session model", () => {
    expect(resolveRoleModels({}, SESSION)).toEqual({proposer: SESSION, judge: SESSION, probe: SESSION});
  });

  test("configured overrides are honored; unset roles stay on the session model", () => {
    const roles = {proposer: "p/prop-model", judge: "j/judge-model"};
    expect(resolveRoleModels(roles, SESSION)).toEqual({
      proposer: "p/prop-model",
      judge: "j/judge-model",
      probe: SESSION,
    });
  });

  test("empty-string values fall back to the session model", () => {
    expect(resolveRoleModels({probe: "", proposer: "p/x"}, SESSION)).toEqual({
      proposer: "p/x",
      judge: SESSION,
      probe: SESSION,
    });
  });

  test("null session model (pi default) propagates to unset roles", () => {
    expect(resolveRoleModels({}, null)).toEqual({proposer: null, judge: null, probe: null});
    expect(resolveRoleModels({judge: "j/x"}, null)).toEqual({proposer: null, judge: "j/x", probe: null});
  });
});

describe("resolveIterationMode", () => {
  const cfg = {default: "surface" as const, auto: true};

  test("first iteration (no previous) uses the config default", () => {
    expect(resolveIterationMode({config: cfg, previous: null})).toEqual({mode: "surface", reason: "config-default"});
    expect(resolveIterationMode({config: {default: "targeted", auto: false}, previous: null}))
      .toEqual({mode: "targeted", reason: "config-default"});
  });

  test("explicit flag wins over everything (user always beats auto behavior)", () => {
    const prevApplied: PreviousIterationModeInput = {mode: "targeted", decision: "applied", taskFailures: 3};
    expect(resolveIterationMode({explicit: "surface", config: cfg, previous: prevApplied}))
      .toEqual({mode: "surface", reason: "explicit-flag"});
    // Even a post-targeted-confirmation situation does not override --mode.
    expect(resolveIterationMode({explicit: "targeted", config: cfg, previous: prevApplied}))
      .toEqual({mode: "targeted", reason: "explicit-flag"});
  });

  test("post-targeted-confirmation: targeted auto-apply forces the next iteration to full suite", () => {
    const prev: PreviousIterationModeInput = {mode: "targeted", decision: "applied", taskFailures: 2};
    expect(resolveIterationMode({config: cfg, previous: prev})).toEqual({mode: "surface", reason: "post-targeted-confirmation"});
    // The dry-run equivalent also counts (winner cleared subset selection).
    const prevDry: PreviousIterationModeInput = {mode: "targeted", decision: "dry-run", taskFailures: 0};
    expect(resolveIterationMode({config: cfg, previous: prevDry})).toEqual({mode: "surface", reason: "post-targeted-confirmation"});
  });

  test("auto-switch: previous iteration with ≥1 baseline failure → targeted", () => {
    const prev: PreviousIterationModeInput = {mode: "surface", decision: "no-winner", taskFailures: 1};
    expect(resolveIterationMode({config: cfg, previous: prev})).toEqual({mode: "targeted", reason: "auto-switch"});
    const many: PreviousIterationModeInput = {mode: "surface", decision: "no-winner", taskFailures: 5};
    expect(resolveIterationMode({config: cfg, previous: many})).toEqual({mode: "targeted", reason: "auto-switch"});
  });

  test("auto-switch off (mode.auto false) or zero failures → config default", () => {
    const prev: PreviousIterationModeInput = {mode: "surface", decision: "no-winner", taskFailures: 2};
    expect(resolveIterationMode({config: {default: "surface", auto: false}, previous: prev}))
      .toEqual({mode: "surface", reason: "config-default"});
    const clean: PreviousIterationModeInput = {mode: "surface", decision: "no-winner", taskFailures: 0};
    expect(resolveIterationMode({config: cfg, previous: clean})).toEqual({mode: "surface", reason: "config-default"});
  });

  test("transition chain: surface failure → targeted → auto-apply → post-targeted-confirmation surface", () => {
    const first = resolveIterationMode({config: cfg, previous: {mode: "surface", decision: "no-winner", taskFailures: 1}});
    expect(first).toEqual({mode: "targeted", reason: "auto-switch"});
    const afterApply = resolveIterationMode({config: cfg, previous: {mode: "targeted", decision: "applied", taskFailures: 1}});
    expect(afterApply).toEqual({mode: "surface", reason: "post-targeted-confirmation"});
    // The confirming surface iteration had failures again → auto-switch back.
    const next = resolveIterationMode({config: cfg, previous: {mode: "surface", decision: "no-winner", taskFailures: 1}});
    expect(next).toEqual({mode: "targeted", reason: "auto-switch"});
  });
});
