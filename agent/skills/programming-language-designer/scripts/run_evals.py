#!/usr/bin/env python3
"""
Run all test evals for the programming-language-designer skill.
Executes pi with and without the skill, saves outputs to iteration-2 workspace.
"""

import json
import os
import subprocess
import sys
import time
import signal
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
import shlex

@dataclass
class Eval:
    id: int
    prompt: str
    expected_output: str
    expectations: List[str]

@dataclass 
class RunResult:
    success: bool
    output: str
    error: Optional[str]
    duration: float
    tokens: Optional[int] = None

def load_evals(skill_dir: Path) -> List[Eval]:
    """Load evals from evals.json"""
    evals_path = skill_dir / "evals" / "evals.json"
    with open(evals_path, 'r') as f:
        data = json.load(f)
    
    evals = []
    for eval_data in data["evals"]:
        evals.append(Eval(
            id=eval_data["id"],
            prompt=eval_data["prompt"],
            expected_output=eval_data["expected_output"],
            expectations=eval_data["expectations"]
        ))
    return evals

def run_pi_command(prompt: str, with_skill: bool, timeout: int = 600) -> RunResult:
    """
    Run pi command with given prompt.
    with_skill=True: run from skill directory (/.pi exists)
    with_skill=False: run from /tmp (no .pi directory)
    """
    start_time = time.time()
    
    if with_skill:
        # Run from skill directory where .pi exists
        cwd = Path(__file__).parent.parent.parent.parent  # /home/rprtr258/pr/lish
    else:
        # Run from /tmp to avoid .pi directory
        cwd = Path("/tmp")
    
    # Create a temporary file for the prompt to avoid shell escaping issues
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(prompt)
        prompt_file = f.name
    
    try:
        # Build command - using --print for non-interactive mode
        cmd = ["pi", "--print", f"@{prompt_file}"]
        
        # Run the command with timeout
        env = os.environ.copy()
        # Ensure we're not inheriting any skill context
        if not with_skill:
            # Remove any PI-related env vars that might affect skill loading
            env = {k: v for k, v in env.items() if not k.startswith(('PI_', 'CLAUDE_'))}
        
        result = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env
        )
        
        duration = time.time() - start_time
        
        if result.returncode == 0:
            # Try to extract token count from output (if available)
            tokens = None
            # Some pi versions output token info at the end
            output_lines = result.stdout.strip().split('\n')
            if output_lines and 'tokens' in output_lines[-1].lower():
                # Simple token extraction
                last_line = output_lines[-1]
                import re
                token_match = re.search(r'(\d+)\s*tokens', last_line, re.IGNORECASE)
                if token_match:
                    tokens = int(token_match.group(1))
                    # Remove token line from output
                    output_lines = output_lines[:-1]
                output = '\n'.join(output_lines)
            else:
                output = result.stdout
            
            return RunResult(
                success=True,
                output=output,
                error=None,
                duration=duration,
                tokens=tokens
            )
        else:
            return RunResult(
                success=False,
                output=result.stdout,
                error=result.stderr,
                duration=duration
            )
            
    except subprocess.TimeoutExpired:
        duration = time.time() - start_time
        return RunResult(
            success=False,
            output="",
            error=f"Command timed out after {timeout} seconds",
            duration=duration
        )
    except Exception as e:
        duration = time.time() - start_time
        return RunResult(
            success=False,
            output="",
            error=str(e),
            duration=duration
        )
    finally:
        # Clean up temp file
        try:
            os.unlink(prompt_file)
        except:
            pass

def save_output(eval_id: int, eval_name: str, with_skill: bool, result: RunResult, workspace_dir: Path):
    """Save output and metadata to workspace directory"""
    config = "with_skill" if with_skill else "without_skill"
    eval_dir_name = {
        1: "design-systems-language",
        2: "delimited-continuations",
        3: "module-comparison",
        4: "dependent-types-typechecker",
        5: "compiled-interpreted-language",
        6: "ast-to-bytecode-guide"
    }[eval_id]
    
    output_dir = workspace_dir / eval_dir_name / config / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Save the output
    output_file = output_dir / f"output.md"
    with open(output_file, 'w') as f:
        f.write(result.output)
    
    # Save metadata
    metadata = {
        "eval_id": eval_id,
        "eval_name": eval_dir_name,
        "configuration": config,
        "prompt": evals[eval_id-1].prompt if eval_id-1 < len(evals) else "",
        "success": result.success,
        "duration_seconds": result.duration,
        "tokens": result.tokens,
        "error": result.error,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    metadata_file = output_dir.parent / "metadata.json"
    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    # Save timing file (format expected by skill-creator)
    timing_file = output_dir.parent / "timing.json"
    timing_data = {
        "total_tokens": result.tokens or 0,
        "duration_ms": int(result.duration * 1000),
        "total_duration_seconds": result.duration
    }
    with open(timing_file, 'w') as f:
        json.dump(timing_data, f, indent=2)
    
    return output_dir

def print_progress(current: int, total: int, eval_name: str, config: str, result: RunResult):
    """Print progress update"""
    status = "✓" if result.success else "✗"
    print(f"[{current}/{total}] {status} {eval_name} ({config}) - {result.duration:.1f}s", end="")
    if result.tokens:
        print(f" - {result.tokens} tokens")
    else:
        print()
    
    if not result.success:
        if result.error:
            print(f"  Error: {result.error[:200]}{'...' if len(result.error) > 200 else ''}")
        if result.output:
            print(f"  Output (first 200 chars): {result.output[:200]}{'...' if len(result.output) > 200 else ''}")

def main():
    workspace_dir = Path(__file__).parent / "iteration-2"
    workspace_dir.mkdir(exist_ok=True)
    
    # Get skill directory (sibling of workspace directory)
    skills_dir = workspace_dir.parent.parent  # /home/rprtr258/pr/lish/.pi/skills
    skill_dir = skills_dir / "programming-language-designer"
    print(f"Running evals from: {skill_dir}")
    print(f"Saving outputs to: {workspace_dir}")
    print("-" * 80)
    
    global evals
    evals = load_evals(skill_dir)
    total_runs = len(evals) * 2  # with and without skill
    completed = 0
    
    # Also save eval_metadata.json files for each eval
    for eval_obj in evals:
        eval_dir_name = {
            1: "design-systems-language",
            2: "delimited-continuations",
            3: "module-comparison",
            4: "dependent-types-typechecker",
            5: "compiled-interpreted-language",
            6: "ast-to-bytecode-guide"
        }[eval_obj.id]
        
        eval_dir = workspace_dir / eval_dir_name
        eval_dir.mkdir(exist_ok=True)
        
        # Save eval_metadata.json with assertions
        metadata = {
            "eval_id": eval_obj.id,
            "eval_name": eval_dir_name,
            "prompt": eval_obj.prompt,
            "assertions": [{"text": exp, "type": "contains"} for exp in eval_obj.expectations]
        }
        
        metadata_file = eval_dir / "eval_metadata.json"
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
    
    # Run all combinations
    results = []
    for eval_obj in evals:
        eval_dir_name = {
            1: "design-systems-language",
            2: "delimited-continuations",
            3: "module-comparison",
            4: "dependent-types-typechecker",
            5: "compiled-interpreted-language",
            6: "ast-to-bytecode-guide"
        }[eval_obj.id]
        
        for with_skill in [True, False]:
            config = "with_skill" if with_skill else "without_skill"
            completed += 1
            
            print(f"\n[{completed}/{total_runs}] Running {eval_dir_name} ({config})...")
            print(f"Prompt: {eval_obj.prompt[:100]}...")
            
            result = run_pi_command(eval_obj.prompt, with_skill)
            
            output_dir = save_output(eval_obj.id, eval_dir_name, with_skill, result, workspace_dir)
            
            print_progress(completed, total_runs, eval_dir_name, config, result)
            
            results.append({
                "eval": eval_dir_name,
                "config": config,
                "success": result.success,
                "duration": result.duration,
                "output_dir": str(output_dir)
            })
            
            # Small delay between runs to avoid rate limiting
            if completed < total_runs:
                time.sleep(2)
    
    # Print summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    successful = sum(1 for r in results if r["success"])
    total_duration = sum(r["duration"] for r in results)
    
    print(f"Total runs: {total_runs}")
    print(f"Successful: {successful}")
    print(f"Failed: {total_runs - successful}")
    print(f"Total time: {total_duration:.1f}s")
    print(f"Average time per run: {total_duration/total_runs:.1f}s")
    
    # Print per-eval summary
    print("\nPer-eval results:")
    for eval_obj in evals:
        eval_dir_name = {
            1: "design-systems-language",
            2: "delimited-continuations",
            3: "module-comparison",
            4: "dependent-types-typechecker",
            5: "compiled-interpreted-language",
            6: "ast-to-bytecode-guide"
        }[eval_obj.id]
        
        eval_results = [r for r in results if r["eval"] == eval_dir_name]
        with_skill = next((r for r in eval_results if r["config"] == "with_skill"), None)
        without_skill = next((r for r in eval_results if r["config"] == "without_skill"), None)
        
        print(f"\n{eval_dir_name}:")
        if with_skill:
            status = "✓" if with_skill["success"] else "✗"
            print(f"  with_skill: {status} ({with_skill['duration']:.1f}s)")
        if without_skill:
            status = "✓" if without_skill["success"] else "✗"
            print(f"  without_skill: {status} ({without_skill['duration']:.1f}s)")
    
    # Save overall results
    summary = {
        "total_runs": total_runs,
        "successful": successful,
        "failed": total_runs - successful,
        "total_duration_seconds": total_duration,
        "average_duration_seconds": total_duration / total_runs if total_runs > 0 else 0,
        "runs": results,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    summary_file = workspace_dir / "run_summary.json"
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nDetailed results saved to: {summary_file}")
    
    if successful < total_runs:
        print("\nWARNING: Some runs failed. Check the individual metadata.json files for details.")
        return 1
    
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\nInterrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)