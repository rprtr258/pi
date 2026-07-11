#!/usr/bin/env python3
"""
Run a complete iteration of skill evaluation.
Usage: python3 run_iteration.py [--iteration N] [--workspace DIR]
"""

import argparse
import json
import os
import sys
from pathlib import Path
import subprocess
import tempfile

def run_evals(skill_dir: Path, workspace_dir: Path, iteration: int):
    """Run all evals with and without skill."""
    # Import the run_evals module (same directory)
    sys.path.insert(0, str(skill_dir / "scripts"))
    try:
        import run_evals
        # Monkey-patch the load_evals to use our skill_dir
        from run_evals import load_evals, run_pi_command, save_output, print_progress
    except ImportError:
        print("Error: run_evals.py not found in scripts directory")
        return False
    
    # Create iteration workspace
    iter_dir = workspace_dir / f"iteration-{iteration}"
    iter_dir.mkdir(exist_ok=True)
    
    # Load evals from skill directory
    evals = load_evals(skill_dir)
    
    # Create eval_metadata.json files for each eval
    for eval_obj in evals:
        eval_dir_name = {
            1: "design-systems-language",
            2: "delimited-continuations",
            3: "module-comparison",
            4: "dependent-types-typechecker",
            5: "compiled-interpreted-language",
            6: "ast-to-bytecode-guide"
        }[eval_obj.id]
        
        eval_dir = iter_dir / eval_dir_name
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
    
    # Run each eval
    total_runs = len(evals) * 2
    completed = 0
    
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
            
            # Use run_evals.run_pi_command
            result = run_pi_command(eval_obj.prompt, with_skill)
            
            # Save output
            output_dir = iter_dir / eval_dir_name / config / "outputs"
            output_dir.mkdir(parents=True, exist_ok=True)
            
            output_file = output_dir / "output.md"
            with open(output_file, 'w') as f:
                f.write(result.output)
            
            # Save metadata
            metadata = {
                "eval_id": eval_obj.id,
                "eval_name": eval_dir_name,
                "configuration": config,
                "prompt": eval_obj.prompt,
                "success": result.success,
                "duration_seconds": result.duration,
                "tokens": result.tokens,
                "error": result.error,
                "timestamp": "timestamp"
            }
            
            metadata_file = output_dir.parent / "metadata.json"
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            # Save timing
            timing_file = output_dir.parent / "timing.json"
            timing_data = {
                "total_tokens": result.tokens or 0,
                "duration_ms": int(result.duration * 1000),
                "total_duration_seconds": result.duration
            }
            with open(timing_file, 'w') as f:
                json.dump(timing_data, f, indent=2)
            
            print(f"  {'✓' if result.success else '✗'} {result.duration:.1f}s")
    
    return True

def grade_evals(skill_dir: Path, workspace_dir: Path, iteration: int):
    """Grade eval outputs."""
    iter_dir = workspace_dir / f"iteration-{iteration}"
    
    # Use grade_evals module
    sys.path.insert(0, str(skill_dir / "scripts"))
    try:
        import grade_evals
        from grade_evals import grade_eval
    except ImportError:
        print("Error: grade_evals.py not found")
        return False
    
    eval_dirs = [
        iter_dir / "design-systems-language",
        iter_dir / "delimited-continuations",
        iter_dir / "module-comparison",
        iter_dir / "dependent-types-typechecker",
        iter_dir / "compiled-interpreted-language",
        iter_dir / "ast-to-bytecode-guide"
    ]
    
    for eval_dir in eval_dirs:
        if not eval_dir.exists():
            continue
        for config in ["with_skill", "without_skill"]:
            grade_eval(eval_dir, config, iter_dir)
    
    return True

def create_benchmark(skill_dir: Path, workspace_dir: Path, iteration: int):
    """Create benchmark.json and benchmark.md."""
    iter_dir = workspace_dir / f"iteration-{iteration}"
    
    # Use create_benchmark module
    sys.path.insert(0, str(skill_dir / "scripts"))
    try:
        import create_benchmark
    except ImportError:
        print("Error: create_benchmark.py not found")
        return False
    
    # Call the create_benchmark function directly
    try:
        create_benchmark.create_benchmark(iter_dir, "programming-language-designer")
    except Exception as e:
        print(f"Error creating benchmark: {e}")
        return False
    
    return True

def generate_review(skill_dir: Path, workspace_dir: Path, iteration: int):
    """Generate review.html using skill-creator's eval-viewer."""
    iter_dir = workspace_dir / f"iteration-{iteration}"
    
    # Path to skill-creator's generate_review.py
    skill_creator_dir = skill_dir.parent / "skill-creator"
    generate_review_script = skill_creator_dir / "eval-viewer" / "generate_review.py"
    
    if not generate_review_script.exists():
        print("Warning: skill-creator eval-viewer not found, skipping review generation")
        return False
    
    # Run the script
    cmd = [
        "python3", str(generate_review_script),
        str(iter_dir),
        "--skill-name", "programming-language-designer",
        "--benchmark", str(iter_dir / "benchmark.json"),
        "--static", str(iter_dir / "review.html")
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error generating review: {result.stderr}")
        return False
    
    print(f"Review generated: {iter_dir / 'review.html'}")
    return True

def main():
    parser = argparse.ArgumentParser(description="Run a complete iteration of skill evaluation")
    parser.add_argument("--iteration", type=int, default=3, help="Iteration number")
    parser.add_argument("--workspace", type=str, 
                       default="/home/rprtr258/pr/lish/.pi/skills/programming-language-designer-workspace",
                       help="Path to workspace directory")
    parser.add_argument("--skip-run", action="store_true", help="Skip running evals")
    parser.add_argument("--skip-grade", action="store_true", help="Skip grading")
    parser.add_argument("--skip-benchmark", action="store_true", help="Skip benchmark creation")
    parser.add_argument("--skip-review", action="store_true", help="Skip review generation")
    
    args = parser.parse_args()
    
    skill_dir = Path(__file__).parent.parent
    workspace_dir = Path(args.workspace)
    
    print(f"Skill directory: {skill_dir}")
    print(f"Workspace directory: {workspace_dir}")
    print(f"Iteration: {args.iteration}")
    print("-" * 80)
    
    # Ensure workspace exists
    workspace_dir.mkdir(exist_ok=True)
    
    success = True
    
    # Step 1: Run evals
    if not args.skip_run:
        print("\n1. Running evals...")
        if not run_evals(skill_dir, workspace_dir, args.iteration):
            success = False
            print("Failed to run evals")
    else:
        print("\n1. Skipping evals run")
    
    # Step 2: Grade evals
    if success and not args.skip_grade:
        print("\n2. Grading evals...")
        if not grade_evals(skill_dir, workspace_dir, args.iteration):
            success = False
            print("Failed to grade evals")
    else:
        print("\n2. Skipping grading")
    
    # Step 3: Create benchmark
    if success and not args.skip_benchmark:
        print("\n3. Creating benchmark...")
        if not create_benchmark(skill_dir, workspace_dir, args.iteration):
            success = False
            print("Failed to create benchmark")
    else:
        print("\n3. Skipping benchmark creation")
    
    # Step 4: Generate review
    if success and not args.skip_review:
        print("\n4. Generating review...")
        if not generate_review(skill_dir, workspace_dir, args.iteration):
            print("Review generation failed (non-fatal)")
    else:
        print("\n4. Skipping review generation")
    
    if success:
        print("\n" + "=" * 80)
        print(f"Iteration {args.iteration} completed successfully!")
        print(f"Results in: {workspace_dir / f'iteration-{args.iteration}'}")
        print("=" * 80)
    else:
        print("\nIteration failed.")
        sys.exit(1)

if __name__ == "__main__":
    main()