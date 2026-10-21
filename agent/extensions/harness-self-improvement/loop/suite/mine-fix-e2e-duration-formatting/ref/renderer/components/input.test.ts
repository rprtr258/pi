import { describe, test, expect } from "bun:test";
import { clampInput } from "../lib/utils";

describe("clampInput", () => {
  test("truncates values longer than max", () => {
    expect(clampInput("hello", 3)).toBe("hel");
  });

  test("leaves short values untouched", () => {
    expect(clampInput("hi", 5)).toBe("hi");
    expect(clampInput("", 3)).toBe("");
  });
});
