import { cn } from "../lib/utils";

export type InputState = {
  invalid?: boolean;
  disabled?: boolean;
};

/**
 * Build the className for a form input from its state flags.
 */
export function buildInputClass(state: InputState): string {
  return cn("input", state.invalid && "input--invalid", state.disabled && "is-disabled");
}
