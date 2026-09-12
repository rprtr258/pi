import {isAbsolute, resolve as resolvePath} from "node:path";
import * as os from "node:os";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
function normalizeUnicodeSpaces(str: string): string {
  return str.replace(UNICODE_SPACES, " ");
}

function normalizeAtPrefix(filePath: string): string {
  return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

function expandPath(filePath: string): string {
  const normalized = normalizeUnicodeSpaces(normalizeAtPrefix(filePath));
  if (normalized === "~") {
    return os.homedir();
  }
  if (normalized.startsWith("~/")) {
    return os.homedir() + normalized.slice(1);
  }
  return normalized;
}

export function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolvePath(cwd, expanded);
}

export function shortenPath(path: string): string {
  if (typeof path !== "string")
    return "";
  const home = os.homedir();
  if (path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}
