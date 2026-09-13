#!/usr/bin/env python3
"""Run trigger evaluation for a skill description.

Tests whether pi triggers (reads) a skill for a set of queries. Each query
runs through a headless `pi -p --mode json` session that loads the skill via
--skill into an otherwise skill-free session; triggering is detected by
watching for a read of the skill's SKILL.md. Outputs results as JSON.
"""

import argparse
import json
import os
import select
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.utils import parse_skill_md

# Session env vars that would make the nested pi session attach to (or fight
# over) the parent pi session. Programmatic subprocess usage is safe.
_SESSION_ENV_VARS = ("PI_SESSION_FILE", "PI_SESSION_ID", "PI_SUBAGENT_PARENT_SESSION")


def _patch_description(skill_md_text: str, description: str) -> str:
  """Replace the SKILL.md frontmatter description with a block scalar.

  Handles both `description: one-liner` and multi-line block scalars: the
  old key and its indented body are dropped, and the new description is
  inserted just before the closing `---`.
  """
  lines = skill_md_text.split("\n")
  fm_start = lines.index("---")
  fm_end = lines.index("---", fm_start + 1)
  new_fm = []
  skipping = False
  for line in lines[fm_start + 1:fm_end]:
    if skipping:
      if line[:1] in (" ", "\t"):
        continue  # body of the old description block scalar
      skipping = False
    if line.startswith("description:"):
      skipping = True
      continue
    new_fm.append(line)
  block = ["description: |"] + ["  " + d for d in description.split("\n")]
  return "\n".join(["---"] + new_fm + block + lines[fm_end:])


def _materialize_skill(skill_path: Path, skill_name: str, description: str, workspace: Path) -> Path:
  """Copy the skill into `workspace` with the candidate description patched in.

  The eval must test the *candidate* description, not whatever is on disk,
  so every query gets a disposable copy of the skill.
  """
  dest = workspace / skill_name
  shutil.copytree(skill_path, dest, ignore=shutil.ignore_patterns(".git", "__pycache__"))
  skill_md = dest / "SKILL.md"
  skill_md.write_text(_patch_description(skill_md.read_text(), description))
  return dest


def run_single_query(
  query: str,
  skill_name: str,
  skill_description: str,
  skill_path: str,
  timeout: int,
  model: str | None = None,
  provider: str | None = None,
) -> bool:
  """Run a single query and return whether the skill was triggered.

  Loads a disposable copy of the skill (with the candidate description
  patched into its frontmatter) via --skill into an otherwise skill-free
  session, then runs `pi -p --mode json` with the raw query. Triggering is
  detected by watching for a read toolCall pointing inside the skill
  directory, which returns early instead of waiting for full completion.
  """
  with tempfile.TemporaryDirectory(prefix="skill-eval-") as workspace_str:
    workspace = Path(workspace_str)
    skill_dir = _materialize_skill(Path(skill_path), skill_name, skill_description, workspace)

    cmd = [
      "pi", "-p", "--mode", "json",
      "--no-session", "--no-skills", "--no-extensions", "--no-context-files",
      "--skill", str(skill_dir),
      query,
    ]
    if model:
      cmd.extend(["--model", model])
    if provider:
      cmd.extend(["--provider", provider])

    # Drop session env vars so the nested pi session doesn't attach to ours.
    env = {k: v for k, v in os.environ.items() if k not in _SESSION_ENV_VARS}

    process = subprocess.Popen(
      cmd,
      stdout=subprocess.PIPE,
      stderr=subprocess.DEVNULL,
      cwd=workspace,
      env=env,
    )

    def reads_skill(path_str) -> bool:
      if not path_str:
        return False
      p = Path(path_str)
      if not p.is_absolute():
        p = workspace / p
      try:
        resolved = p.resolve()
      except OSError:
        return False
      return resolved == skill_dir or skill_dir in resolved.parents

    triggered = False
    start_time = time.time()
    buffer = ""

    try:
      while time.time() - start_time < timeout:
        if process.poll() is not None:
          remaining = process.stdout.read()
          if remaining:
            buffer += remaining.decode("utf-8", errors="replace")
          break

        ready, _, _ = select.select([process.stdout], [], [], 1.0)
        if not ready:
          continue

        chunk = os.read(process.stdout.fileno(), 8192)
        if not chunk:
          break
        buffer += chunk.decode("utf-8", errors="replace")

        while "\n" in buffer:
          line, buffer = buffer.split("\n", 1)
          line = line.strip()
          if not line:
            continue

          try:
            event = json.loads(line)
          except json.JSONDecodeError:
            continue

          # Trigger detection: a read toolCall pointing inside the skill dir.
          message = event.get("message") or {}
          for content_item in message.get("content") or []:
            if not isinstance(content_item, dict):
              continue
            if content_item.get("type") != "toolCall":
              continue
            args = content_item.get("arguments") or {}
            if reads_skill(args.get("path")):
              return True

          # A provider error ends the run early; report whatever we saw.
          if event.get("type") == "message_end" and message.get("stopReason") == "error":
            return triggered
    finally:
      # Clean up process on any exit path (return, exception, timeout)
      if process.poll() is None:
        process.kill()
        process.wait()

    return triggered


def run_eval(
  eval_set: list[dict],
  skill_name: str,
  description: str,
  num_workers: int,
  timeout: int,
  skill_path: Path,
  runs_per_query: int = 1,
  trigger_threshold: float = 0.5,
  model: str | None = None,
  provider: str | None = None,
) -> dict:
  """Run the full eval set and return results."""
  results = []

  with ProcessPoolExecutor(max_workers=num_workers) as executor:
    future_to_info = {}
    for item in eval_set:
      for run_idx in range(runs_per_query):
        future = executor.submit(
          run_single_query,
          item["query"],
          skill_name,
          description,
          str(skill_path),
          timeout,
          model,
          provider,
        )
        future_to_info[future] = (item, run_idx)

    query_triggers: dict[str, list[bool]] = {}
    query_items: dict[str, dict] = {}
    for future in as_completed(future_to_info):
      item, _ = future_to_info[future]
      query = item["query"]
      query_items[query] = item
      if query not in query_triggers:
        query_triggers[query] = []
      try:
        query_triggers[query].append(future.result())
      except Exception as e:
        print(f"Warning: query failed: {e}", file=sys.stderr)
        query_triggers[query].append(False)

  for query, triggers in query_triggers.items():
    item = query_items[query]
    trigger_rate = sum(triggers) / len(triggers)
    should_trigger = item["should_trigger"]
    if should_trigger:
      did_pass = trigger_rate >= trigger_threshold
    else:
      did_pass = trigger_rate < trigger_threshold
    results.append({
      "query": query,
      "should_trigger": should_trigger,
      "trigger_rate": trigger_rate,
      "triggers": sum(triggers),
      "runs": len(triggers),
      "pass": did_pass,
    })

  passed = sum(1 for r in results if r["pass"])
  total = len(results)

  return {
    "skill_name": skill_name,
    "description": description,
    "results": results,
    "summary": {
      "total": total,
      "passed": passed,
      "failed": total - passed,
    },
  }


def main():
  parser = argparse.ArgumentParser(description="Run trigger evaluation for a skill description")
  parser.add_argument("--eval-set", required=True, help="Path to eval set JSON file")
  parser.add_argument("--skill-path", required=True, help="Path to skill directory")
  parser.add_argument("--description", default=None, help="Override description to test")
  parser.add_argument("--num-workers", type=int, default=10, help="Number of parallel workers")
  parser.add_argument("--timeout", type=int, default=30, help="Timeout per query in seconds")
  parser.add_argument("--runs-per-query", type=int, default=3, help="Number of runs per query")
  parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger rate threshold")
  parser.add_argument("--model", default=None, help="Model to use for pi -p, e.g. 'google/gemini-2.5-pro' (default: $PI_MODEL, else pi config default)")
  parser.add_argument("--provider", default=None, help="Provider to use for pi -p (default: $PI_PROVIDER, else pi config default)")
  parser.add_argument("--verbose", action="store_true", help="Print progress to stderr")
  args = parser.parse_args()

  eval_set = json.loads(Path(args.eval_set).read_text())
  skill_path = Path(args.skill_path)

  if not (skill_path / "SKILL.md").exists():
    print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
    sys.exit(1)

  name, original_description, content = parse_skill_md(skill_path)
  description = args.description or original_description
  model = args.model or os.environ.get("PI_MODEL")
  provider = args.provider or os.environ.get("PI_PROVIDER")

  if args.verbose:
    print(f"Evaluating: {description}", file=sys.stderr)

  output = run_eval(
    eval_set=eval_set,
    skill_name=name,
    description=description,
    num_workers=args.num_workers,
    timeout=args.timeout,
    skill_path=skill_path,
    runs_per_query=args.runs_per_query,
    trigger_threshold=args.trigger_threshold,
    model=model,
    provider=provider,
  )

  if args.verbose:
    summary = output["summary"]
    print(f"Results: {summary['passed']}/{summary['total']} passed", file=sys.stderr)
    for r in output["results"]:
      status = "PASS" if r["pass"] else "FAIL"
      rate_str = f"{r['triggers']}/{r['runs']}"
      print(f"  [{status}] rate={rate_str} expected={r['should_trigger']}: {r['query'][:70]}", file=sys.stderr)

  print(json.dumps(output, indent=2))


if __name__ == "__main__":
  main()
