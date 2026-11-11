/**
 * Shared helpers for the renderer.
 */

export function clampInput(value: string, max: number): string {
  return value.slice(0, max);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}
