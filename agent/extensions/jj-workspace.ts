/**
 * jj-workspace extension
 *
 * Adds a `/jj-workspace [revision]` command that:
 *   1. Creates a jj workspace under the system temp dir (name:
 *      `<repo>-<timestamp>`) with a new working-copy commit on top of the
 *      given revision (default `@`).
 *   2. Switches pi into it — a fresh session is created whose working
 *      directory is the new workspace, so all tools (bash, read, edit, ...)
 *      operate there from now on.
 *
 * The previous session is kept; `/resume` switches back to it.
 *
 * When pi exits from inside a temp workspace, the extension cleans it up:
 * empty workspaces are forgotten and deleted; dirty ones get their
 * working-copy commit bookmarked first (verified to be visible from the
 * default workspace) so the changes survive the cleanup.
 */
import {execFile} from "node:child_process";
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve, sep} from "node:path";
import {promisify} from "node:util";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {SessionManager} from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

const TMP_BASE = () => join(tmpdir(), "jj-ws");

function sanitizeName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "workspace";
}

function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function uniqueTarget(base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (existsSync(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/** True when an absolute workspace root is one of this extension's temp workspaces. */
function isTempWorkspace(root: string): boolean {
  return root.startsWith(TMP_BASE() + sep);
}

/** Extract a readable message from an exec error (prefers stderr). */
function errText(err: unknown): string {
  if (err instanceof Error && "stderr" in err) {
    const stderr = String((err as {stderr?: string}).stderr).trim();
    if (stderr) return stderr;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Resolve the default workspace root from a secondary workspace: its
 * `.jj/repo` entry is a symlink (or, in git-colocated repos, a relative
 * path) pointing at the primary workspace's `.jj/repo`. */
function defaultWorkspaceRoot(workspaceRoot: string): string | null {
  try {
    const pointer = join(workspaceRoot, ".jj", "repo");
    const repoDir = lstatSync(pointer).isSymbolicLink()
      ? realpathSync(pointer)
      : resolve(dirname(pointer), readFileSync(pointer, "utf8").trim());
    return dirname(dirname(repoDir)); // strip /.jj/repo
  } catch {
    return null;
  }
}

/** Bookmark the dirty working-copy commit so it survives `jj workspace
 * forget`, then verify the bookmark resolves from the default workspace. */
async function bookmarkWorkingCopy(name: string, workspaceRoot: string, defaultRoot: string | null): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? name : `${name}-${i + 1}`;
    try {
      await execFileAsync("jj", ["bookmark", "create", candidate, "-r", "@"], { cwd: workspaceRoot });
      await execFileAsync("jj", ["log", "-r", candidate, "--no-graph", "-T", "commit_id"], { cwd: defaultRoot ?? workspaceRoot });
      return candidate;
    } catch (err: unknown) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`could not bookmark working copy as ${name}`);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("jj-workspace", {
    description: "Create a jj workspace in a temp dir and cd this session into it (usage: /jj-workspace [revision], default: @)",
    handler: async (args, ctx) => {
      // Resolve the current workspace root; doubles as the "is this a jj repo" check.
      let repoRoot: string;
      try {
        const { stdout } = await execFileAsync("jj", ["workspace", "root"], { cwd: ctx.cwd });
        repoRoot = stdout.trim();
      } catch (err: unknown) {
        const reason = err instanceof Error && "stderr" in err && String((err as { stderr?: string }).stderr).trim()
          ? String((err as { stderr?: string }).stderr).trim()
          : err instanceof Error
            ? err.message
            : String(err);
        ctx.ui.notify(`Not in a jj repository (from ${ctx.cwd}): ${reason}`, "error");
        return;
      }

      // The workspace's working-copy commit is a fresh commit on top of the
      // given revision (as if `jj new <revset>`); default is the current @.
      const revision = args.trim() || "@";
      const name = `${sanitizeName(basename(repoRoot))}-${timestampSuffix()}`;
      const target = await uniqueTarget(join(TMP_BASE(), name));
      mkdirSync(TMP_BASE(), { recursive: true });

      try {
        await execFileAsync("jj", ["workspace", "add", "-r", revision, target], { cwd: ctx.cwd });
      } catch (err: unknown) {
        // jj registers the workspace (and may leave a stray working-copy commit)
        // before failing on a bad revision — clean up so the source repo and
        // temp dir don't accumulate broken workspaces.
        try {
          await execFileAsync("jj", ["workspace", "forget", basename(target)], { cwd: ctx.cwd });
        } catch {
          // workspace may not have been registered; nothing else to do
        }
        rmSync(target, { recursive: true, force: true });
        const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr?: string }).stderr).trim() : "";
        ctx.ui.notify(`jj workspace add -r ${revision} failed: ${stderr || String(err)}`, "error");
        return;
      }

      let sessionFile: string | undefined;
      try {
        // Create the session record. SessionManager persists lazily (only once
        // there is a real conversation entry), so flush the header line manually —
        // otherwise switchSession's SessionManager.open() sees no file and falls
        // back to process.cwd() instead of the new workspace.
        const sessionManager = SessionManager.create(target);
        sessionFile = sessionManager.getSessionFile();
        const header = sessionManager.getHeader();
        if (!sessionFile || !header) {
          throw new Error("session manager returned no file/header");
        }
        writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, { flag: "wx" });
      } catch (err: unknown) {
        ctx.ui.notify(`Workspace created at ${target}, but session creation failed: ${String(err)}`, "error");
        return;
      }

      try {
        await ctx.switchSession(sessionFile, {
          withSession: async (replacement) => {
            replacement.ui.notify(`Now in jj workspace ${target} — old session kept, /resume to switch back`, "info");
          },
        });
      } catch (err: unknown) {
        ctx.ui.notify(`Workspace created at ${target}, but session switch failed: ${String(err)}`, "error");
      }
    },
  });

  // Clean up the temp workspace when pi exits from inside it. Only on
  // "quit": reload/resume/fork/new replace the session while the workspace
  // may still be in use.
  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason !== "quit") return;
    if (!resolve(ctx.cwd).startsWith(TMP_BASE() + sep)) return;

    let root: string;
    try {
      const { stdout } = await execFileAsync("jj", ["workspace", "root"], { cwd: ctx.cwd });
      root = stdout.trim();
    } catch {
      return; // not inside a jj repo
    }
    if (!isTempWorkspace(root) || !existsSync(root)) return;

    const name = basename(root);
    const defaultRoot = defaultWorkspaceRoot(root);

    // Empty workspaces are dropped as-is; dirty ones get their working-copy
    // commit bookmarked first — `jj workspace forget` would otherwise abandon
    // it along with the uncommitted changes.
    let bookmark: string | null = null;
    try {
      const { stdout } = await execFileAsync("jj", ["log", "-r", "@", "--no-graph", "-T", "empty"], { cwd: root });
      if (stdout.trim() !== "true") {
        bookmark = await bookmarkWorkingCopy(name, root, defaultRoot);
      }
    } catch (err: unknown) {
      // Unknown state or changes could not be protected: leave everything.
      if (ctx.hasUI) {
        ctx.ui.notify(`jj workspace ${root} left in place: ${errText(err)}`, "error");
      }
      return;
    }

    let forgetError: string | undefined;
    try {
      await execFileAsync("jj", ["workspace", "forget", name], { cwd: defaultRoot ?? root });
    } catch (err: unknown) {
      forgetError = errText(err);
    }
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (err: unknown) {
      if (ctx.hasUI) {
        ctx.ui.notify(`Failed to remove workspace directory ${root}: ${errText(err)}`, "error");
      }
    }

    if (ctx.hasUI) {
      if (bookmark) {
        ctx.ui.notify(`Cleaned up jj workspace ${name} — changes kept in bookmark ${bookmark}, visible from the default workspace`, "info");
      } else {
        ctx.ui.notify(`Cleaned up empty jj workspace ${name}`, "info");
      }
      if (forgetError) {
        ctx.ui.notify(`jj workspace forget ${name} failed: ${forgetError}`, "error");
      }
    }
  });
}
