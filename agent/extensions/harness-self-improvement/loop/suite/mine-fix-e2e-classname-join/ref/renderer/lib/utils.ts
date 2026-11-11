export type ClassValue = string | false | null | undefined;

/**
 * Join class names, skipping falsy values.
 */
export function cn(...classes: ClassValue[]): string {
  return classes.filter((c) => typeof c === "string").join(" ");
}
