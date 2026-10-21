/**
 * Unit tests for the harness-loop sample extension (Step 9a): the default
 * export registers its tool ONLY when HARNESS_LOOP_SAMPLE=1, and the exported
 * registerSampleTool registers the echo tool unconditionally.
 *
 *   cd extensions/harness-loop-sample && bun test
 */
import {afterEach, describe, expect, test} from "bun:test";
import sampleExtension, {registerSampleTool, SAMPLE_ENV_VAR, SAMPLE_TOOL_NAME} from "./index.ts";

/** Capture registerTool calls on a fake ExtensionAPI surface. */
function captureRegistry(): {names: string[]; pi: {registerTool: (cfg: {name: string}) => void}} {
  const names: string[] = [];
  return {names, pi: {registerTool: (cfg: {name: string}) => names.push(cfg.name)}};
}

const originalEnv = process.env[SAMPLE_ENV_VAR];
afterEach(() => {
  if (originalEnv === undefined) delete process.env[SAMPLE_ENV_VAR];
  else process.env[SAMPLE_ENV_VAR] = originalEnv;
});

describe("sample extension inertness", () => {
  test("default export registers the echo tool when HARNESS_LOOP_SAMPLE=1", () => {
    process.env[SAMPLE_ENV_VAR] = "1";
    const {names, pi} = captureRegistry();
    sampleExtension(pi as never);
    expect(names).toEqual([SAMPLE_TOOL_NAME]);
  });

  test("default export is INERT without the env var (normal sessions)", () => {
    delete process.env[SAMPLE_ENV_VAR];
    const {names, pi} = captureRegistry();
    sampleExtension(pi as never);
    expect(names).toEqual([]);
  });

  test("default export is inert when the env var is set to something else", () => {
    process.env[SAMPLE_ENV_VAR] = "0";
    const {names, pi} = captureRegistry();
    sampleExtension(pi as never);
    expect(names).toEqual([]);
  });

  test("registerSampleTool registers the echo tool directly", () => {
    const {names, pi} = captureRegistry();
    expect(registerSampleTool(pi)).toBe(true);
    expect(names).toEqual([SAMPLE_TOOL_NAME]);
  });
});
