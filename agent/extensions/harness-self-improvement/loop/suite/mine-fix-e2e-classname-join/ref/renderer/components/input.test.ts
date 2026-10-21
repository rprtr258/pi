import { describe, expect, test } from "bun:test";
import { cn } from "../lib/utils";

describe("cn", () => {
  test("joins with single spaces", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  test("skips falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  test("returns empty string when nothing valid", () => {
    expect(cn(false, null, undefined)).toBe("");
  });
});
