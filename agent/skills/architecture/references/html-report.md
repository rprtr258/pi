# HTML Report Format

The architectural review is rendered as a single self-contained HTML file in the OS temp directory. Tailwind and Mermaid both come from CDNs. Mermaid handles graph-shaped diagrams reliably; hand-built divs and inline SVG handle editorial visuals like mass diagrams and cross-sections. Mix the two.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review — {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({
        startOnLoad: true,
        theme: "neutral",
        securityLevel: "loose",
      });
    </script>
    <style>
      .seam {
        stroke-dasharray: 4 4;
      }
      .leak {
        stroke: #dc2626;
      }
      .deep {
        background: linear-gradient(135deg, #0f172a, #1e293b);
      }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Repo name, date, and a compact legend: solid box = module, dashed line = seam, red arrow = leakage, thick dark box = deep module. No introduction paragraph — straight into the candidates.

## Candidate Card

The diagrams carry the weight. Prose is sparse, plain, and uses the glossary terms from [language](language.md) without ceremony.

Each candidate is one `<article>`:

- **Title** — short, names the deepening.
- **Badge row** — recommendation strength (`Strong` = emerald, `Worth exploring` = amber, `Speculative` = slate), plus a tag for the dependency category (`in-process`, `local-substitutable`, `remote-owned`, `external`).
- **Files** — monospaced list, `font-mono text-sm`.
- **Before / After diagram** — the centrepiece. Two columns, side by side.
- **Problem** — one sentence. What hurts.
- **Solution** — one sentence. What changes.
- **Wins** — bullets, ≤6 words each.

No paragraphs of explanation. If the diagram needs a paragraph to be understood, redraw the diagram.

## Diagram Patterns

### Mermaid graph

Use a Mermaid `flowchart` or `graph` when the point is call flow or dependencies. Wrap it in a Tailwind-styled card. Style leakage edges red and the deep module dark.

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepository]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### Hand-built boxes-and-arrows

Use modules as `<div>`s with borders and labels. Use inline SVG `<line>` or `<path>` arrows over a relative container. Reach for this when the after diagram should feel like one thick-bordered deep module with greyed-out internals.

### Cross-section

Stack horizontal bands to show layers a call passes through. Before: many thin layers each doing little. After: one thick band labelled with the consolidated responsibility.

### Mass diagram

Two rectangles per module: one for interface surface area, one for implementation. Before: interface rectangle nearly as tall as implementation. After: interface short, implementation tall.

### Call-graph collapse

Before: a tree of function calls rendered as nested boxes. After: the same tree collapsed into one box, with internal calls faded inside it.

## Style Guidance

- Lean editorial, not corporate dashboard.
- Use generous whitespace.
- Use colour sparingly: one accent plus red for leakage and amber for warnings.
- Keep diagrams around 320px tall.
- Use `text-xs uppercase tracking-wider` for module labels inside diagrams.
- The only scripts are Tailwind CDN and Mermaid ESM import.

## Top Recommendation

One larger card: candidate name, one sentence on why, anchor link to its card.

## Tone

Plain English, concise, and vocabulary-disciplined.

Use exactly: module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

Avoid substituting: component, unit, API, signature, boundary when seam is meant, generic service when module is meant.

Phrasings that fit:

- "Order intake module is shallow — interface nearly matches the implementation."
- "Pricing leaks across the seam."
- "Deepen: one interface, one place to test."
- "Two adapters justify the seam: HTTP in production, in-memory in tests."

Wins bullets should name the gain:

- "locality: one module"
- "leverage: N call sites"
- "interface shrinks"
- "tests cross one seam"

No hedging, no throat-clearing, no "it's worth noting that." If a sentence could be a bullet, make it a bullet.
