# Pinning The Repository And Versions

Full rules for pinning the repository and toolchain versions before writing a
lathe tutorial, linked from the skill. A tutorial is only as trustworthy as the
versions it's rooted in. Settle both before you research or write, then pass
them to `lathe store`; in `lathe serve`, tutorials group by repository and
versions show as filterable chips, so a stale-toolchain tutorial is
identifiable at a glance.

## 1. The repository (auto-detect, then confirm)

If this session is inside a git repository the tutorial is *for*, capture it:

```bash
git -C "$PWD" remote get-url origin 2>/dev/null   # the remote (preferred grouping key)
git -C "$PWD" branch --show-current 2>/dev/null    # the branch
```

Show the reader what you found — *"This looks like it's for
**devenjarvis/lathe** (branch `main`) — group it there?"* — and let them
confirm, correct, or say it's a standalone tutorial. No remote, no git, or
standalone → skip the repository ("No repository" group). `lathe store`
canonicalizes the URL to `host/org/repo`, so the raw `origin` URL is fine.

## 2. The toolchain versions (detect, then confirm)

Probe the versions of the languages/tools the tutorial will lean on, and
**confirm the target with the reader before you write** — getting this wrong
means the tutorial teaches against the wrong version:

```bash
zig version     # → 0.13.0
go version      # → go1.22.3
node --version  # → v20.11.0
rustc --version # → 1.75.0
```

Propose them — *"I'll write this against **Zig 0.13.0** and **LLVM 18** — sound
right, or do you want a different target?"* — and adjust to whatever the reader
says (they may want an older version on purpose). Pinned versions are a
constraint on your prose: cite version-specific behavior accordingly, and
anchor version-sensitive facts to the pinned version.
