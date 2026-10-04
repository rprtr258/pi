# Automatic Benchmarking Tooling

Bundled tooling for si-skill-creator: scripted, repeatable benchmarks. All tools run on pi (`pi -p` headless sessions) and inherit the session's model via `$PI_MODEL`/`$PI_PROVIDER`, or take `--model`/`--provider`.

## Workspace layout (per skill under test)

```
<skill-name>-workspace/
├── skill/          # the skill being evaluated
└── evals/evals.json   # {"query": ..., "context": ...} entries; see schemas.md
```

## Run trigger + behavior benchmarks

```bash
cd <skill-name>-workspace
python3 <path-to-this-skill>/scripts/run_eval.py \
  --eval-set evals/evals.json --skill-path skill \
  --num-workers 5 --timeout 60
```

Output is JSON: per-query trigger results + summary (schemas: [schemas.md](schemas.md)).

For behavior benchmarks (with-skill vs baseline, grading, timing): run the pairs, capture per-assertion grading into `grading.json` and timing data into `timing.json`, then aggregate:

```bash
python3 <path>/scripts/aggregate_benchmark.py --results <skill-name>/evals/
```

Produces `benchmark.json` + human-readable `benchmark.md` (mean ± stddev per assertion, per skill).

## Interactive review

```bash
python3 <path>/eval-viewer/generate_review.py evals/*.json -o review.html
# Viewer can't load local files? Add --static to inline everything.
```

The user reviews and records verdicts in `feedback.json`; the skill is iterated from them. If `generate_review.py` fails, fall back to showing `benchmark.md` and walking the user through it.
