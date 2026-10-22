/**
 * Tests for the questionnaire tool's interactive UI rendering.
 *
 * The UI must never overflow the given terminal width, and long text
 * (prompts, option labels, option descriptions) must be wrapped to
 * multiple lines instead of being clipped with an ellipsis — including
 * when navigating between tabs of a multi-question questionnaire.
 *
 *   cd extensions/questionnaire && bun test
 */

import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
// eslint-disable-next-line import/no-relative-packages
import questionnaireExtension from "./index.ts";

type ToolConfig = Parameters<Parameters<typeof questionnaireExtension>[0]["registerTool"]>[0];

// tsc cannot resolve the legacy `@mariozechner/pi-coding-agent` import (pi aliases
// it at runtime), so parameter types collapse to `any` there; type the captured
// tool by the surface the tests actually use.
let tool: { execute: (...args: unknown[]) => Promise<unknown> } | undefined;
questionnaireExtension({
  registerTool: (cfg: ToolConfig) => {
    tool = cfg as unknown as typeof tool;
  },
} as unknown as Parameters<typeof questionnaireExtension>[0]);

interface QuestionInput {
  id: string;
  label?: string;
  prompt: string;
  options: { value: string; label: string; description?: string }[];
  allowOther?: boolean;
}

/** Open the questionnaire UI on its first tab and return the rendered component. */
function openQuestionnaireUI(params: { questions: QuestionInput[] }) {
  let component!: { render: (width: number) => string[]; invalidate: () => void; handleInput: (data: string) => void };
  const ctx = {
    hasUI: true,
    ui: {
      custom: (factory: (tui: unknown, theme: unknown, kb: unknown, done: unknown) => unknown) => {
        const theme = {
          fg: (_color: string, text: string) => text,
          bg: (_color: string, text: string) => text,
        };
        component = factory({ requestRender() {} }, theme, {}, () => {}) as typeof component;
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

const LONG_PROMPT = `${"This is an extremely long question that goes on and on and asks about many different things ".repeat(3).trimEnd()}?`;
const LONG_LABEL = "A very long option label which should be wrapped onto several lines instead of being cut off";
const LONG_DESCRIPTION = `${"Some long description text explaining this option in great detail for the user ".repeat(3).trimEnd()}.`;

const qWithLongText = (id: string): QuestionInput => ({
  id,
  label: `Tab ${id.toUpperCase()}`,
  prompt: `Question ${id}: ${LONG_PROMPT}`,
  options: [{ value: "a", label: LONG_LABEL, description: LONG_DESCRIPTION }, { value: "b", label: "short" }],
});

test("every rendered line fits within the terminal width (single question)", () => {
  const component = openQuestionnaireUI({ questions: [qWithLongText("a")] });
  expect(fitsWidth(component.render(40), 40)).toBe(true);
});

test("every rendered line fits within the terminal width (multiple questions)", () => {
  const component = openQuestionnaireUI({ questions: [qWithLongText("a"), qWithLongText("b")] });
  expect(fitsWidth(component.render(40), 40)).toBe(true);
});

test("long option descriptions are preserved (wrapped, not clipped)", () => {
  const component = openQuestionnaireUI({ questions: [qWithLongText("a")] });
  expect(normalized(plainText(component.render(40)))).toContain(normalized(LONG_DESCRIPTION));
});

test("long option labels are preserved (wrapped, not clipped)", () => {
  const component = openQuestionnaireUI({ questions: [qWithLongText("a")] });
  expect(normalized(plainText(component.render(40)))).toContain(normalized(`${LONG_LABEL}`));
});

test("long prompts are preserved (wrapped, not clipped)", () => {
  const component = openQuestionnaireUI({ questions: [qWithLongText("a")] });
  expect(normalized(plainText(component.render(40)))).toContain(normalized(`Question a: ${LONG_PROMPT}`));
});

test("re-render at a narrower width does not overflow (terminal resize)", () => {
  const component = openQuestionnaireUI({ questions: [qWithLongText("a")] });
  component.render(80);
  // Terminal got resized; the TUI simply calls render() with the new width.
  const lines = component.render(40);
  expect(fitsWidth(lines, 40)).toBe(true);
});

test("tab navigation preserves long text on every question tab", () => {
  const component = openQuestionnaireUI({ questions: [qWithLongText("a"), qWithLongText("b")] });
  component.render(40);
  // → moves to the next question's tab
  component.handleInput("\x1b[C");
  const lines = component.render(40);
  expect(fitsWidth(lines, 40)).toBe(true);
  expect(normalized(plainText(lines))).toContain(normalized(`Question b: ${LONG_PROMPT}`));
  expect(normalized(plainText(lines))).toContain(normalized(LONG_DESCRIPTION));
});
