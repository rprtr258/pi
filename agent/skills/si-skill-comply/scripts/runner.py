"""Run scenarios via pi --mode json and parse tool calls from the event stream."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from typing import Any
from dataclasses import dataclass
from pathlib import Path

from scripts.parser import ObservationEvent
from scripts.scenario_generator import Scenario

SANDBOX_BASE = Path("/tmp/skill-comply-sandbox")
ALLOWED_MODELS = frozenset({"haiku", "sonnet", "opus"})


@dataclass(frozen=True)
class ScenarioRun:
  scenario: Scenario
  observations: tuple[ObservationEvent, ...]
  sandbox_dir: Path


def run_scenario(
  scenario: Scenario,
  model: str = "sonnet",
  timeout: int = 300,
) -> ScenarioRun:
  """Execute a scenario and extract tool calls from stream-json output."""
  if model not in ALLOWED_MODELS:
    raise ValueError(f"Unknown model: {model!r}. Allowed: {ALLOWED_MODELS}")

  sandbox_dir = _safe_sandbox_dir(scenario.id)
  _setup_sandbox(sandbox_dir, scenario)

  result = subprocess.run(
    [
      "pi", "--mode", "json", "--no-session", "--no-extensions",
      "--no-context-files",
      "--tools", "read,write,edit,bash,grep,find,ls",
      "--model", model,
      scenario.prompt,
    ],
    capture_output=True,
    text=True,
    timeout=timeout,
    cwd=sandbox_dir,
  )

  if result.returncode != 0:
    raise RuntimeError(
      f"pi failed (rc={result.returncode}): {result.stderr[:500]}"
    )

  observations = _parse_pi_json(result.stdout)

  return ScenarioRun(
    scenario=scenario,
    observations=tuple(observations),
    sandbox_dir=sandbox_dir,
  )


def _safe_sandbox_dir(scenario_id: str) -> Path:
  """Sanitize scenario ID and ensure path stays within sandbox base."""
  safe_id = re.sub(r"[^a-zA-Z0-9\-_]", "_", scenario_id)
  path = SANDBOX_BASE / safe_id
  # Validate path stays within sandbox base (raises ValueError on traversal)
  path.resolve().relative_to(SANDBOX_BASE.resolve())
  return path


def _setup_sandbox(sandbox_dir: Path, scenario: Scenario) -> None:
  """Create sandbox directory and run setup commands."""
  if sandbox_dir.exists():
    shutil.rmtree(sandbox_dir)
  sandbox_dir.mkdir(parents=True)

  subprocess.run(["git", "init"], cwd=sandbox_dir, capture_output=True)

  for cmd in scenario.setup_commands:
    if cmd.strip():
      subprocess.run(cmd, shell=True, cwd=sandbox_dir, capture_output=True)


def _parse_pi_json(stdout: str) -> list[ObservationEvent]:
  """Parse pi --mode json output into ObservationEvents.

  Format (docs/json.md):
  - type=session header → session id
  - type=tool_execution_start → tool call (toolCallId, toolName, args)
  - type=tool_execution_end → tool result (toolCallId, result, isError)
  """
  events: list[ObservationEvent] = []
  pending: dict[str, dict[str, Any]] = {}
  event_counter = 0
  session_id = "unknown"

  for line in stdout.strip().splitlines():
    try:
      msg = json.loads(line)
    except json.JSONDecodeError:
      continue

    match msg.get("type"):
      case "session":
        session_id = msg.get("id", "unknown")

      case "tool_execution_start":
        tool_input = msg.get("args", {})
        input_str = (
          json.dumps(tool_input)[:5000]
          if isinstance(tool_input, dict)
          else str(tool_input)[:5000]
        )
        pending[msg.get("toolCallId", "")] = {
          "tool": msg.get("toolName", "unknown"),
          "input": input_str,
          "order": event_counter,
        }
        event_counter += 1

      case "tool_execution_end":
        info = pending.pop(msg.get("toolCallId", ""), None)
        if info is None:
          continue
        result_content = msg.get("result", "")
        output_str = (
          json.dumps(result_content)[:5000]
          if isinstance(result_content, (dict, list))
          else str(result_content)[:5000]
        )
        if msg.get("isError"):
          output_str = f"[error] {output_str}"[:5000]

        events.append(ObservationEvent(
          timestamp=f"T{info['order']:04d}",
          event="tool_complete",
          tool=info["tool"],
          session=session_id,
          input=info["input"],
          output=output_str,
        ))

      case _: pass

  for _tool_use_id, info in pending.items():
    events.append(ObservationEvent(
      timestamp=f"T{info['order']:04d}",
      event="tool_complete",
      tool=info["tool"],
      session=session_id,
      input=info["input"],
      output="",
    ))

  return sorted(events, key=lambda e: e.timestamp)
