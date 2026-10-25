#!/usr/bin/env bun
// Checker for shell-robust-backup.
// $1 = workspace path; read-only for this script. Exit 0 = pass, non-zero = fail.
// All scratch fixtures are created in a private temp dir, never inside $1.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: workspace path argument missing");
  process.exit(1);
}

function fail(msg: string): never {
  console.log(`FAIL: ${msg}`);
  process.exit(1);
}

const backup = join(ws, "backup.sh");
if (!existsSync(backup)) fail("backup.sh missing");
if (!(statSync(backup).mode & 0o111)) fail("backup.sh is not executable");

function run(args: string[]): {code: number; stderr: string} {
  try {
    execFileSync(backup, args, {stdio: ["ignore", "pipe", "pipe"]});
    return {code: 0, stderr: ""};
  } catch (e) {
    const err = e as {status?: number; stderr?: Buffer};
    return {code: err.status ?? -1, stderr: (err.stderr ?? "").toString()};
  }
}

const tmp = mkdtempSync(join(tmpdir(), "harness-check-backup-"));
try {
  // T1/T2: usage errors -> exit 2 and a "Usage" hint on stderr.
  const r1 = run([]);
  if (!r1.stderr.toLowerCase().includes("usage")) {
    fail(`no usage message on stderr when called without arguments (got: ${r1.stderr.trim()})`);
  }
  if (r1.code !== 2) fail(`expected exit 2 without arguments, got: exit=${r1.code}`);

  const r2 = run(["only-one-arg"]);
  if (!r2.stderr.toLowerCase().includes("usage")) {
    fail("no usage message on stderr when called with one argument");
  }
  if (r2.code !== 2) fail(`expected exit 2 with one argument, got: exit=${r2.code}`);

  // T3: missing source dir -> exit 1.
  const r3 = run([join(tmp, "no-such-dir"), join(tmp, "dest3")]);
  if (r3.code !== 1) fail(`expected exit 1 for missing source dir, got: exit=${r3.code}`);

  // T4: happy path, existing dest dir.
  const src = join(tmp, "src");
  const dest4 = join(tmp, "dest4");
  mkdirSync(src, {recursive: true});
  mkdirSync(dest4, {recursive: true});
  writeFileSync(join(src, "a.txt"), "alpha\n");
  writeFileSync(join(src, "beta file.txt"), "beta\n"); // path with a space
  const r4 = run([src, dest4]);
  if (r4.code !== 0) fail(`expected exit 0 on happy path, got: exit=${r4.code} (${r4.stderr.trim()})`);
  if (!existsSync(join(dest4, "backup.tar.gz"))) fail("archive not created at DEST_DIR/backup.tar.gz");
  const listing = execFileSync("tar", ["-tzf", join(dest4, "backup.tar.gz")], {encoding: "utf8"});
  if (!listing.includes("a.txt")) fail("archive does not contain a.txt");
  const x4 = join(tmp, "x4");
  mkdirSync(x4, {recursive: true});
  execFileSync("tar", ["-xzf", join(dest4, "backup.tar.gz"), "-C", x4]);
  if (readFileSync(join(x4, "beta file.txt"), "utf8").trim() !== "beta") {
    fail("archive content wrong for file with space in name");
  }

  // T5: missing dest dir is created; re-run overwrites.
  const dest5 = join(tmp, "dest5");
  rmSync(dest5, {recursive: true, force: true});
  writeFileSync(join(src, "c.txt"), "gamma\n");
  const r5 = run([src, dest5]);
  if (r5.code !== 0) fail(`expected exit 0 when DEST_DIR does not exist, got: exit=${r5.code} (${r5.stderr.trim()})`);
  if (!existsSync(dest5)) fail("DEST_DIR was not created");
  const listing5 = execFileSync("tar", ["-tzf", join(dest5, "backup.tar.gz")], {encoding: "utf8"});
  if (!listing5.includes("c.txt")) fail("second archive missing c.txt");
} finally {
  rmSync(tmp, {recursive: true, force: true});
}

console.log("PASS: backup.sh handles usage errors, missing dirs, spaces, and overwrite");
