/**
 * Tests for the question tool's interactive UI rendering.
 *
 * The UI must never overflow the given terminal width, and long text
 * (question, option labels, option descriptions) must be wrapped to
 * multiple lines instead of being clipped with an ellipsis.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
// eslint-disable-next-line import/no-relative-packages
import questionExtension from "./question.ts";

type ToolConfig = Parameters<Parameters<typeof questionExtension>[0]["registerTool"]>[0];

// tsc cannot resolve the legacy `@mariozechner/pi-coding-agent` import (pi aliases
// it at runtime), so parameter types collapse to `any` there; type the captured
// tool by the surface the tests actually use.
let tool: { execute: (...args: unknown[]) => Promise<unknown> } | undefined;
questionExtension({
  registerTool: (cfg: ToolConfig) => {
    tool = cfg as unknown as typeof tool;
  },
} as unknown as Parameters<typeof questionExtension>[0]);

/** Open the interactive question UI and return the rendered component. */
function openQuestionUI(params: { question: string; options: { label: string; description?: string }[] }) {
  let component!: { render: (width: number) => string[]; invalidate: () => void; handleInput: (data: string) => void };
  const ctx = {
    hasUI: true,
    ui: {
      custom: (factory: (tui: unknown, theme: unknown, kb: unknown, done: unknown) => unknown) => {
        const theme = { fg: (_color: string, text: string) => text };
        component = factory({}, theme, {}, () => {}) as typeof component;
        return new Promise(() => {}); // UI stays open; we only inspect rendering
      },
    },
  };
  void tool!.execute("test-id", params, undefined, undefined, ctx);
  return component;
}

/** Joined text of rendered lines (theme mock emits plain, ANSI-free strings). */
const plainText = (lines: string[]) => lines.join("\n");

/** Whitespace-insensitive comparison basis (line breaks replace spaces when text wraps). */
const normalized = (s: string) => s.replace(/\s+/g, " ").trim();

const fitsWidth = (lines: string[], width: number) => lines.every((line) => visibleWidth(line) <= width);

const LONG_QUESTION = `${"This is an extremely long question that goes on and on and asks about many things ".repeat(4).trimEnd()}?`;
const LONG_LABEL = "A very long option label which should be wrapped onto several lines instead of being cut off";
const LONG_DESCRIPTION = `${"Some long description text explaining this option in great detail for the user ".repeat(3).trimEnd()}.`;

test("every rendered line fits within the terminal width", () => {
  const component = openQuestionUI({
    question: LONG_QUESTION,
    options: [{ label: LONG_LABEL, description: LONG_DESCRIPTION }, { label: "short" }],
  });
  expect(fitsWidth(component.render(40), 40)).toBe(true);
});

test("long question is preserved (wrapped, not clipped)", () => {
  const component = openQuestionUI({ question: LONG_QUESTION, options: [{ label: "ok" }] });
  expect(normalized(plainText(component.render(40)))).toContain(normalized(LONG_QUESTION));
});

test("long option labels are preserved (wrapped, not clipped)", () => {
  const component = openQuestionUI({ question: "Pick one", options: [{ label: LONG_LABEL }, { label: "b" }] });
  expect(normalized(plainText(component.render(40)))).toContain(normalized(LONG_LABEL));
});

test("long option descriptions are preserved (wrapped, not clipped)", () => {
  const component = openQuestionUI({
    question: "Pick one",
    options: [{ label: "a", description: LONG_DESCRIPTION }, { label: "b" }],
  });
  expect(normalized(plainText(component.render(40)))).toContain(normalized(LONG_DESCRIPTION));
});

test("re-render at a narrower width does not overflow (terminal resize)", () => {
  const component = openQuestionUI({
    question: "Pick one",
    options: [{ label: LONG_LABEL, description: LONG_DESCRIPTION }],
  });
  component.render(80);
  // Terminal got resized; the TUI simply calls render() with the new width.
  const lines = component.render(40);
  expect(fitsWidth(lines, 40)).toBe(true);
});
