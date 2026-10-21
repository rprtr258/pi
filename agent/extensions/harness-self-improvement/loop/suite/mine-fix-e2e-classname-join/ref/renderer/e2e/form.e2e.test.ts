import { describe, expect, test } from "bun:test";
import { buildInputClass } from "../components/input";

describe("form input e2e", () => {
  test("invalid state class chain", () => {
    expect(buildInputClass({ invalid: true, disabled: false })).toBe(
      "input input--invalid",
    );
  });

  test("disabled state class chain", () => {
    expect(buildInputClass({ invalid: false, disabled: true })).toBe(
      "input is-disabled",
    );
  });

  test("combined states keep order and single spaces", () => {
    expect(buildInputClass({ invalid: true, disabled: true })).toBe(
      "input input--invalid is-disabled",
    );
  });

  test("no stray whitespace for clean state", () => {
    expect(buildInputClass({ invalid: false, disabled: false })).toBe("input");
  });
});
