#!/usr/bin/env python3
"""
Grade eval outputs against expectations.
Creates grading.json files in each run directory.
"""

import json
import os
import re
from pathlib import Path
from typing import List, Dict, Any

def check_assertion(assertion: Dict[str, Any], content: str) -> Dict[str, Any]:
    """Check a single assertion against content."""
    text = assertion["text"]
    assertion_type = assertion.get("type", "contains")
    
    passed = False
    evidence = ""
    
    # Convert to lowercase for case-insensitive matching (but preserve original for evidence)
    content_lower = content.lower()
    text_lower = text.lower()
    
    if assertion_type == "contains":
        # Simple keyword/pattern matching based on assertion text
        # This is heuristic - in a real grader you'd do more sophisticated checking
        
        # Common patterns to check for
        patterns = {
            "language name": r'\b[A-Z][a-zA-Z]+\b',  # Capitalized word as language name
            "elevator pitch": r'core idea|elevator pitch|in one sentence|summary',
            "syntax": r'syntax|grammar|BNF|keyword|operator|precedence',
            "type system": r'type system|built.in type|composite|generic|inference|struct|enum|tuple',
            "memory management": r'memory|ownership|borrow|allocation|garbage|heap|stack|arena|malloc|free',
            "concurrency": r'concurrency|thread|async|await|synchronization|mutex|channel|lock',
            "standard library": r'standard library|stdlib|library module|platform',
            "sample program": r'```[\s\S]*?```',  # Code blocks
            "safety": r'safety|memory safe|type safe|data race|buffer overflow',
            "performance": r'performance|zero.cost|optimization|fast|efficient|low.overhead',
            "dependency order": r'first|then|after|before|lower.level|higher.level'
        }
        
        # Check for language name specifically
        if "language name" in text_lower:
            # Look for capitalized word that might be language name
            name_match = re.search(r'\b([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b', content)
            if name_match and len(name_match.group(1)) > 2:
                passed = True
                evidence = f"Language name found: {name_match.group(1)}"
            else:
                # Check for explicit "language called" pattern
                if re.search(r'language (?:called|named|is) ["\']?([^"\'\s]+)', content, re.IGNORECASE):
                    passed = True
                    evidence = "Language name mentioned explicitly"
                else:
                    passed = False
                    evidence = "No clear language name found"
        
        # Check for sample program length
        elif "sample program" in text_lower and "20 lines" in text_lower:
            code_blocks = re.findall(r'```[\s\S]*?```', content)
            if code_blocks:
                total_lines = sum(len(block.split('\n')) for block in code_blocks)
                if total_lines >= 20:
                    passed = True
                    evidence = f"Code blocks contain {total_lines} total lines"
                else:
                    passed = False
                    evidence = f"Code blocks only contain {total_lines} lines (need 20+)"
            else:
                passed = False
                evidence = "No code blocks found"
        
        # Generic keyword matching for other assertions
        else:
            # Build search terms from assertion text
            search_terms = []
            for key, pattern in patterns.items():
                if key in text_lower:
                    search_terms.append(pattern)
            
            if search_terms:
                combined_pattern = '|'.join(search_terms)
                matches = re.findall(combined_pattern, content_lower, re.IGNORECASE)
                if matches:
                    passed = True
                    unique_matches = list(set(matches))[:3]  # Show first 3 unique matches
                    evidence = f"Found relevant terms: {', '.join(unique_matches)}"
                else:
                    passed = False
                    evidence = f"No matching terms found for: {text}"
            else:
                # Fallback: check if any words from assertion appear in content
                words = re.findall(r'\b\w+\b', text_lower)
                matching_words = [w for w in words if len(w) > 3 and w in content_lower]
                if matching_words:
                    passed = True
                    evidence = f"Found related words: {', '.join(matching_words[:3])}"
                else:
                    passed = False
                    evidence = f"No matching content found"
    
    elif assertion_type == "count":
        # Count-based assertions (e.g., "at least two reasons")
        try:
            # Extract number from text
            num_match = re.search(r'(\d+)', text)
            if num_match:
                min_count = int(num_match.group(1))
                # Count occurrences of relevant terms
                count = 0
                # Simple heuristic: count bullet points or numbered items
                bullets = len(re.findall(r'^[\-\*•]\s', content, re.MULTILINE))
                numbers = len(re.findall(r'^\d+\.\s', content, re.MULTILINE))
                count = max(bullets, numbers, 1)  # Fallback
                
                passed = count >= min_count
                evidence = f"Found {count} items (need {min_count}+)"
            else:
                passed = False
                evidence = "Could not parse count requirement"
        except:
            passed = False
            evidence = "Error evaluating count assertion"
    
    elif assertion_type == "lines":
        # Line count assertions
        try:
            num_match = re.search(r'(\d+)', text)
            if num_match:
                min_lines = int(num_match.group(1))
                lines = content.split('\n')
                # Count non-empty lines
                non_empty = sum(1 for line in lines if line.strip())
                passed = non_empty >= min_lines
                evidence = f"Document has {non_empty} non-empty lines (need {min_lines}+)"
            else:
                passed = False
                evidence = "Could not parse line count requirement"
        except:
            passed = False
            evidence = "Error evaluating line count"
    
    else:
        # Unknown assertion type
        passed = False
        evidence = f"Unknown assertion type: {assertion_type}"
    
    return {
        "text": text,
        "passed": passed,
        "evidence": evidence
    }

def grade_eval(eval_dir: Path, config: str, workspace_dir: Path):
    """Grade a single eval configuration."""
    config_dir = eval_dir / config
    outputs_dir = config_dir / "outputs"
    eval_metadata_path = eval_dir / "eval_metadata.json"
    
    if not outputs_dir.exists():
        print(f"Warning: No outputs directory for {eval_dir.name}/{config}")
        return
    
    output_file = outputs_dir / "output.md"
    if not output_file.exists():
        print(f"Warning: No output.md for {eval_dir.name}/{config}")
        return
    
    # Load eval metadata
    with open(eval_metadata_path, 'r') as f:
        eval_metadata = json.load(f)
    
    # Load output content
    with open(output_file, 'r') as f:
        content = f.read()
    
    # Check each assertion
    expectations = []
    for assertion in eval_metadata.get("assertions", []):
        result = check_assertion(assertion, content)
        expectations.append(result)
    
    # Calculate summary
    passed_count = sum(1 for e in expectations if e["passed"])
    total_count = len(expectations)
    pass_rate = passed_count / total_count if total_count > 0 else 0
    
    # Create grading.json
    grading = {
        "expectations": expectations,
        "summary": {
            "passed": passed_count,
            "failed": total_count - passed_count,
            "total": total_count,
            "pass_rate": pass_rate
        },
        "execution_metrics": {
            "tool_calls": {},
            "total_tool_calls": 0,
            "total_steps": 1,
            "errors_encountered": 0,
            "output_chars": len(content),
            "transcript_chars": 0
        },
        "timing": {
            "executor_duration_seconds": 0,
            "grader_duration_seconds": 0,
            "total_duration_seconds": 0
        },
        "claims": [],
        "user_notes_summary": {
            "uncertainties": [],
            "needs_review": [],
            "workarounds": []
        },
        "eval_feedback": {
            "suggestions": [],
            "overall": "Automated grading based on keyword matching. Manual review recommended for accuracy."
        }
    }
    
    # Load timing data if available
    timing_path = config_dir / "timing.json"
    if timing_path.exists():
        with open(timing_path, 'r') as f:
            timing_data = json.load(f)
            grading["timing"]["executor_duration_seconds"] = timing_data.get("total_duration_seconds", 0)
            grading["timing"]["total_duration_seconds"] = timing_data.get("total_duration_seconds", 0)
    
    # Save grading.json
    grading_path = config_dir / "grading.json"
    with open(grading_path, 'w') as f:
        json.dump(grading, f, indent=2)
    
    print(f"Graded {eval_dir.name}/{config}: {passed_count}/{total_count} passed ({pass_rate:.1%})")
    
    return grading

def grade_all_evals(workspace_dir: Path):
    """Grade all evals in the given workspace directory."""
    if not workspace_dir.exists():
        print(f"Workspace directory not found: {workspace_dir}")
        return None
    
    eval_dirs = [
        workspace_dir / "design-systems-language",
        workspace_dir / "delimited-continuations",
        workspace_dir / "module-comparison",
        workspace_dir / "dependent-types-typechecker",
        workspace_dir / "compiled-interpreted-language",
        workspace_dir / "ast-to-bytecode-guide"
    ]
    
    all_gradings = []
    
    for eval_dir in eval_dirs:
        if not eval_dir.exists():
            print(f"Eval directory not found: {eval_dir}")
            continue
        
        for config in ["with_skill", "without_skill"]:
            grading = grade_eval(eval_dir, config, workspace_dir)
            if grading:
                all_gradings.append({
                    "eval": eval_dir.name,
                    "config": config,
                    "pass_rate": grading["summary"]["pass_rate"]
                })
    
    # Print summary
    print("\n" + "=" * 80)
    print("GRADING SUMMARY")
    print("=" * 80)
    
    for grad in all_gradings:
        print(f"{grad['eval']}/{grad['config']}: {grad['pass_rate']:.1%}")
    
    # Calculate overall stats
    with_skill = [g for g in all_gradings if g["config"] == "with_skill"]
    without_skill = [g for g in all_gradings if g["config"] == "without_skill"]
    
    if with_skill:
        avg_with = sum(g["pass_rate"] for g in with_skill) / len(with_skill)
        print(f"\nAverage with_skill: {avg_with:.1%}")
    
    if without_skill:
        avg_without = sum(g["pass_rate"] for g in without_skill) / len(without_skill)
        print(f"Average without_skill: {avg_without:.1%}")
    
    if with_skill and without_skill:
        print(f"Delta: +{avg_with - avg_without:.1%}")
    
    return all_gradings


def main():
    workspace_dir = Path(__file__).parent / "iteration-2"
    grade_all_evals(workspace_dir)

if __name__ == "__main__":
    main()