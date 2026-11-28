import { describe, test, expect } from "bun:test";
import { formatDuration } from "../lib/utils";

// E2E coverage for the session timer shown in the input bar.
// Do not change expectations here; fix the implementation instead.
describe("formatDuration (e2e)", () => {
  test("renders zero as 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  test("rounds to the nearest second", () => {
    expect(formatDuration(500)).toBe("0:01");
    expect(formatDuration(65_500)).toBe("1:06");
  });

  test("does not lose a second at minute boundaries", () => {
    expect(formatDuration(3_599_900)).toBe("60:00");
  });

  test("keeps seconds zero-padded", () => {
    expect(formatDuration(65_000)).toBe("1:05");
  });
});
