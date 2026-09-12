/**
 * Hashline Edit Tool - standalone pi extension.
 *
 * A compact, line-anchored edit format. Each section starts with `@PATH`.
 * Edit ops reference lines by line number + content hash ("anchors", e.g. `5sr`, `123ab`).
 *
 * <ops>
 *   @PATH       header: subsequent ops apply to PATH
 *   < ANCHOR    insert lines BEFORE the anchored line (or BOF)
 *   + ANCHOR    insert lines AFTER  the anchored line (or EOF)
 *   - A..B      delete the line range (inclusive); `- A` for one line
 *   = A..B      replace the range with payload lines
 * </ops>
 *
 * Payload lines start with the configured separator (default `~`).
 *
 * References:
 * - https://blog.can.ac/2026/02/12/the-harness-problem/
 * - https://github.com/can1357/oh-my-pi/tree/main/packages/hashline
 */

import {readFile, stat} from "node:fs/promises";
import {readFileSync, writeFileSync} from "node:fs";
import {xxh32} from "xxh32";
import {Type, type Static} from "typebox";
import {Text} from "@earendil-works/pi-tui";
import {type ExtensionAPI, type AgentToolResult, type ThemeColor, Theme} from "@earendil-works/pi-coding-agent";

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as any).code === "ENOENT";
}


const SEP = "~";

const SEP_RE = escapeRe(SEP);
const BODY_SEP = "|";
const ANCHOR_REBASE_WINDOW = 5;
const MISMATCH_CONTEXT = 2;

/** Bigram table (647 entries) - stable, each entry is 1 BPE token */
const BIGRAMS = [
  "aa","ab","ac","ad","ae","af","ag","ah","ai","aj","ak","al","am","an","ao","ap","aq","ar","as","at","au","av","aw","ax","ay","az",
  "ba","bb","bc","bd","be","bf","bg","bh","bi","bj","bk","bl","bm","bn","bo","bp","br","bs","bt","bu","bv","bw","bx","by","bz",
  "ca","cb","cc","cd","ce","cf","cg","ch","ci","cj","ck","cl","cm","cn","co","cp","cq","cr","cs","ct","cu","cv","cw","cx","cy","cz",
  "da","db","dc","dd","de","df","dg","dh","di","dj","dk","dl","dm","dn","do","dp","dq","dr","ds","dt","du","dv","dw","dx","dy","dz",
  "ea","eb","ec","ed","ee","ef","eg","eh","ei","ej","ek","el","em","en","eo","ep","eq","er","es","et","eu","ev","ew","ex","ey","ez",
  "fa","fb","fc","fd","fe","ff","fg","fh","fi","fj","fk","fl","fm","fn","fo","fp","fq","fr","fs","ft","fu","fv","fw","fx","fy","fz",
  "ga","gb","gc","gd","ge","gf","gg","gh","gi","gj","gl","gm","gn","go","gp","gr","gs","gt","gu","gv","gw","gx","gy","gz",
  "ha","hb","hc","hd","he","hf","hg","hh","hi","hj","hk","hl","hm","hn","ho","hp","hq","hr","hs","ht","hu","hv","hw","hx","hy","hz",
  "ia","ib","ic","id","ie","if","ig","ih","ii","ij","ik","il","im","in","io","ip","iq","ir","is","it","iu","iv","iw","ix","iy","iz",
  "ja","jb","jc","jd","je","jf","jg","jh","ji","jj","jk","jl","jm","jn","jo","jp","jq","jr","js","jt","ju","jw","jx","jy",
  "ka","kb","kc","kd","ke","kf","kg","kh","ki","kj","kk","kl","km","kn","ko","kp","kr","ks","kt","ku","kv","kw","kx","ky",
  "la","lb","lc","ld","le","lf","lg","lh","li","lj","lk","ll","lm","ln","lo","lp","lr","ls","lt","lu","lv","lw","lx","ly","lz",
  "ma","mb","mc","md","me","mf","mg","mh","mi","mj","mk","ml","mm","mn","mo","mp","mq","mr","ms","mt","mu","mv","mw","mx","my","mz",
  "na","nb","nc","nd","ne","nf","ng","nh","ni","nj","nk","nl","nm","nn","no","np","nr","ns","nt","nu","nv","nw","nx","ny","nz",
  "oa","ob","oc","od","oe","of","og","oh","oi","oj","ok","ol","om","on","oo","op","oq","or","os","ot","ou","ov","ow","ox","oy","oz",
  "pa","pb","pc","pd","pe","pf","pg","ph","pi","pj","pk","pl","pm","pn","po","pp","pq","pr","ps","pt","pu","pv","pw","px","py","pz",
  "qa","qb","qc","qd","qe","qh","qi","ql","qm","qn","qo","qp","qq","qr","qs","qt","qu","qw","qx","qy",
  "ra","rb","rc","rd","re","rf","rg","rh","ri","rk","rl","rm","rn","ro","rp","rq","rr","rs","rt","ru","rv","rw","rx","ry","rz",
  "sa","sb","sc","sd","se","sf","sg","sh","si","sj","sk","sl","sm","sn","so","sp","sq","sr","ss","st","su","sv","sw","sx","sy","sz",
  "ta","tb","tc","td","te","tf","tg","th","ti","tj","tk","tl","tm","tn","to","tp","tr","ts","tt","tu","tv","tw","tx","ty","tz",
  "ua","ub","uc","ud","ue","uf","ug","uh","ui","uj","uk","ul","um","un","uo","up","uq","ur","us","ut","uu","uv","uw","ux","uy","uz",
  "va","vb","vc","vd","ve","vf","vg","vh","vi","vj","vk","vl","vm","vn","vo","vp","vq","vr","vs","vt","vu","vv","vw","vx","vy","vz",
  "wa","wb","wc","wd","we","wf","wg","wh","wi","wj","wk","wl","wm","wn","wo","wp","wr","ws","wt","wu","wv","ww","wx","wy",
  "xa","xb","xc","xd","xe","xf","xh","xi","xl","xm","xn","xo","xp","xr","xs","xt","xu","xx","xy","xz",
  "ya","yb","yc","yd","ye","yf","yg","yh","yi","yj","yk","yl","ym","yn","yo","yp","yr","ys","yt","yu","yv","yw","yx","yy","yz",
  "za","zb","zc","zd","ze","zf","zg","zh","zi","zk","zl","zm","zn","zo","zp","zr","zs","zt","zu","zw","zx","zy","zz",
] as const;
const BIGRAMS_COUNT = BIGRAMS.length;
const RE_SIGNIFICANT = /[\p{L}\p{N}]/u;


/** Compute a 2-character hash of a line via xxh32 mod 647. */
function computeLineHash(idx: number, line: string): string {
  const seed = RE_SIGNIFICANT.test(line) ? 0 : idx;
  return BIGRAMS[xxh32(line, seed) % BIGRAMS_COUNT]!;
}

/** Format `LINE|TEXT` with hash. */
function formatHashLine(lineNumber: number, lineText: string): string {
  return `${lineNumber}${computeLineHash(lineNumber, lineText)}${BODY_SEP}${lineText}`;
}
/** Format `LINE|TEXT` without hash. */
function formatLinePlain(lineNumber: number, lineText: string): string {
  return `${lineNumber}${BODY_SEP}${lineText}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}



// Anchor parsing

/** Parse a `LINE+HASH` reference like `42sr` from text. */
function parseLid(raw: string): { line: number; hash: string } | undefined {
  const m = raw.match(/^([1-9]\d*)([a-z]{2})$/);
  if (!m) return undefined;
  return { line: Number(m[1]), hash: m[2]! };
}

/** Parse a range like `42sr..56ab` or just `42sr`. */
function parseRange(raw: string): { from: { line: number; hash: string }; to?: { line: number; hash: string } } | undefined {
  const parts = raw.split("..");
  if (parts.length > 2) return undefined;
  const from = parseLid(parts[0]!.trim());
  if (!from) return undefined;
  if (parts.length === 2) {
    const to = parseLid(parts[1]!.trim());
    if (!to) return undefined;
    return { from, to };
  }
  return { from };
}

type Anchor = {
  line: number,
  hash: string,
  contentHint?: string,
};

type HashlineOp =
  | { kind: "insert_before"; anchor: Anchor; text: string }
  | { kind: "insert_after"; anchor: Anchor; text: string }
  | { kind: "delete"; range: { from: Anchor; to?: Anchor } }
  | { kind: "replace"; range: { from: Anchor; to?: Anchor }; text: string }
  | { kind: "insert_before_bof"; text: string }
  | { kind: "insert_after_bof"; text: string }
  | { kind: "insert_before_eof"; text: string }
  | { kind: "insert_after_eof"; text: string }
  | { kind: "inline_before"; anchor: Anchor; suffix: string }
  | { kind: "inline_after"; anchor: Anchor; suffix: string };

function op_range(op: HashlineOp, len: number): [from: number, to: number] {
  switch (op.kind) {
    case "insert_before": return [op.anchor.line, op.anchor.line];
    case "insert_after": return [op.anchor.line, op.anchor.line];
    case "delete": return [op.range.from.line, op.range.to?.line ?? op.range.from.line];
    case "replace": return [op.range.from.line, op.range.to?.line ?? op.range.from.line];
    case "inline_before": return [op.anchor.line, op.anchor.line];
    case "inline_after": return [op.anchor.line, op.anchor.line];
    case "insert_before_bof": return [0, 0];
    case "insert_after_bof": return [0, 0];
    case "insert_before_eof": return [len, len];
    case "insert_after_eof": return [len, len];
  }
}

type FileSection = {
  path: string,
  ops: HashlineOp[],
  warnings: string[],
};

const FILE_HEADER_PREFIX = "@";

/** hashline DSL parsing */
export function parseHashline(input: string): {
  sections: FileSection[],
  warnings: string[],
} {
  const lines = input.split("\n");

  let currentPath = "";
  const sections: FileSection[] = [];
  let currentOps: HashlineOp[] = [];
  function flush() {
    if (currentPath) {
      sections.push({ path: currentPath, ops: currentOps, warnings: [] });
    }
    currentOps = [];
  }

  const warnings: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i]!;
    if (line.startsWith(FILE_HEADER_PREFIX)) {
      flush();
      const pathPart = line.slice(1);
      // Strip quotes if path is quoted
      currentPath = pathPart.startsWith('"') && pathPart.endsWith('"')
        ? pathPart.slice(1, -1)
        : pathPart.startsWith("'") && pathPart.endsWith("'")
          ? pathPart.slice(1, -1)
          : pathPart;
      i++;
      continue;
    }

    if (line.trim() === "" || line.startsWith("#")) {
      i++;
      continue;
    }

    // Try to parse as an op line
    const opLine = line.trimStart();
    let parsed: { op: HashlineOp; payloadLines: number } | undefined;

    if (opLine.startsWith("<")) {
      const rest = opLine.slice(1).trim();
      parsed = parseInsertOp("<", rest, lines, i);
    } else if (opLine.startsWith("+")) {
      const rest = opLine.slice(1).trim();
      parsed = parseInsertOp("+", rest, lines, i);
    } else if (opLine.startsWith("-")) {
      const rest = opLine.slice(1).trim();
      parsed = parseDeleteOp(rest);
    } else if (opLine.startsWith("=")) {
      const rest = opLine.slice(1).trim();
      parsed = parseReplaceOp(rest, lines, i);
    }

    if (parsed) {
      currentOps.push(parsed.op);
      i += parsed.payloadLines + 1;
    } else {
      warnings.push(`line ${i + 1}: unrecognized op "${line.slice(0, 60)}"`);
      i++;
    }
  }

  flush();
  for (const section of sections) {
    section.ops.sort((a, b) => {
      const ar = op_range(a, lines.length);
      const br = op_range(b, lines.length);
      return br[0] - ar[1];
    });
  }
  return { sections, warnings };
}

function parseInsertOp(
  prefix: string,
  rest: string,
  lines: string[],
  lineIdx: number,
): { op: HashlineOp; payloadLines: number } | undefined {
  // Check for inline modify: `+ ANCHOR_SEPtext`
  const sepIdx = rest.search(new RegExp(SEP_RE));
  if (sepIdx >= 0) {
    const anchorRaw = rest.slice(0, sepIdx).trim();
    const suffix = rest.slice(sepIdx + SEP.length);
    const anchor = parseLid(anchorRaw);
    if (anchor) {
      const op: HashlineOp = prefix === "<"
        ? { kind: "inline_before", anchor, suffix }
        : { kind: "inline_after", anchor, suffix };
      return { op, payloadLines: 0 };
    }
  }

  // Check for BOF / EOF
  const target = rest.trim();
  if (target === "BOF") {
    const payload = collectPayload(lines, lineIdx + 1);
    const op: HashlineOp = prefix === "<"
      ? { kind: "insert_before_bof", text: payload.text }
      : { kind: "insert_after_bof", text: payload.text };
    return { op, payloadLines: payload.count };
  }
  if (target === "EOF") {
    const payload = collectPayload(lines, lineIdx + 1);
    const op: HashlineOp = prefix === "<"
      ? { kind: "insert_before_eof", text: payload.text }
      : { kind: "insert_after_eof", text: payload.text };
    return { op, payloadLines: payload.count };
  }

  // Regular anchor
  const anchor = parseLid(target);
  if (anchor) {
    const payload = collectPayload(lines, lineIdx + 1);
    const op: HashlineOp = prefix === "<"
      ? { kind: "insert_before", anchor, text: payload.text }
      : { kind: "insert_after", anchor, text: payload.text };
    return { op, payloadLines: payload.count };
  }

  return undefined;
}

function parseDeleteOp(rest: string): { op: HashlineOp; payloadLines: number } | undefined {
  const range = parseRange(rest);
  if (!range) return undefined;
  const op: HashlineOp = {
    kind: "delete",
    range: {
      from: { line: range.from.line, hash: range.from.hash },
      to: range.to ? { line: range.to.line, hash: range.to.hash } : undefined,
    },
  };
  return { op, payloadLines: 0 };
}

function parseReplaceOp(rest: string, lines: string[], lineIdx: number): { op: HashlineOp; payloadLines: number } | undefined {
  const range = parseRange(rest);
  if (!range) return undefined;
  const payload = collectPayload(lines, lineIdx + 1);
  return {
    op: {
      kind: "replace",
      range: {
        from: { line: range.from.line, hash: range.from.hash },
        to: range.to ? { line: range.to.line, hash: range.to.hash } : undefined,
      },
      text: payload.text,
    },
    payloadLines: payload.count,
  };
}

/** Collect payload lines starting with the separator. */
function collectPayload(lines: string[], startIdx: number): { text: string; count: number } {
  const payloadLines: string[] = [];
  const sepPat = new RegExp(`^\\s*${SEP_RE}`);
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i]!;
    const raw = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (sepPat.test(raw)) {
      payloadLines.push(raw.replace(sepPat, ""));
      i++;
    } else {
      break;
    }
  }

  return { text: payloadLines.join("\n"), count: payloadLines.length };
}

// Hash validation & rebasing

function validateHash(anchor: Anchor, lines: string[]): { valid: boolean; actualHash?: string } {
  if (anchor.line < 1 || anchor.line > lines.length) return { valid: false };
  const line = lines[anchor.line - 1]!;
  const actualHash = computeLineHash(anchor.line, line);
  return { valid: actualHash === anchor.hash, actualHash };
}

function tryRebaseAnchor(anchor: Anchor, lines: string[]): Anchor | undefined {
  // Search in a window around the expected line
  const start = Math.max(0, anchor.line - 1 - ANCHOR_REBASE_WINDOW);
  const end = Math.min(lines.length, anchor.line + ANCHOR_REBASE_WINDOW);

  for (let i = start; i < end; i++) {
    if (i === anchor.line - 1)
      continue; // already checked
    const line = lines[i]!;
    const hash = computeLineHash(i + 1, line);
    if (hash === anchor.hash) {
      return { line: i + 1, hash };
    }
  }
  return undefined;
}

function formatMismatchContext(anchor: Anchor, lines: string[]): string {
  const parts: string[] = [];
  const start = Math.max(0, anchor.line - 1 - MISMATCH_CONTEXT);
  const end = Math.min(lines.length, anchor.line + MISMATCH_CONTEXT);

  for (let i = start; i < end; i++) {
    const lineNum = i + 1;
    const line = lines[i]!;
    const hash = computeLineHash(lineNum, line);
    const marker = lineNum === anchor.line ? ">>>" : "   ";
    parts.push(`${marker} ${formatHashLine(lineNum, line)}`);
  }

  return parts.join("\n");
}

type ApplyResult = {
  lines: string[],
  firstChangedLine?: number,
  warnings: string[],
};

function applyHashlineEdits(sourceLines: string[], ops: HashlineOp[]): ApplyResult {
  let lines = [...sourceLines];
  const warnings: string[] = [];
  let firstChangedLine: number | undefined;

  // Process ops in order (top-down). We track line shifts.
  for (const op of ops) {
    switch (op.kind) {
      case "insert_before": {
        const { valid, actualHash } = validateHash(op.anchor, lines);
        if (!valid) {
          const rebased = tryRebaseAnchor(op.anchor, lines);
          if (rebased) {
            warnings.push(`Rebased anchor ${op.anchor.line}${op.anchor.hash} -> ${rebased.line}${rebased.hash}`);
            op.anchor.line = rebased.line;
          } else {
            const actual = actualHash ? ` (found hash ${actualHash})` : " (line out of range)";
            throw new HashlineError(
              `Anchor mismatch: line ${op.anchor.line} expected hash ${op.anchor.hash}${actual}`,
              op.anchor,
              lines,
            );
          }
        }
        const idx = op.anchor.line - 1;
        const payload = op.text.split("\n");
        lines.splice(idx, 0, ...payload);
        firstChangedLine ??= op.anchor.line;
        break;
      }
      case "insert_after": {
        const { valid, actualHash } = validateHash(op.anchor, lines);
        if (!valid) {
          const rebased = tryRebaseAnchor(op.anchor, lines);
          if (rebased) {
            warnings.push(`Rebased anchor ${op.anchor.line}${op.anchor.hash} -> ${rebased.line}${rebased.hash}`);
            op.anchor.line = rebased.line;
          } else {
            const actual = actualHash ? ` (found hash ${actualHash})` : " (line out of range)";
            throw new HashlineError(
              `Anchor mismatch: line ${op.anchor.line} expected hash ${op.anchor.hash}${actual}`,
              op.anchor,
              lines,
            );
          }
        }
        const idx = op.anchor.line; // insert after line
        const payload = op.text.split("\n");
        lines.splice(idx, 0, ...payload);
        firstChangedLine ??= op.anchor.line + 1;
        break;
      }
      case "inline_before": {
        const { valid } = validateHash(op.anchor, lines);
        if (!valid) throw new HashlineError(
          `Anchor mismatch at line ${op.anchor.line} (expected hash ${op.anchor.hash})`,
          op.anchor,
          lines,
        );
        const idx = op.anchor.line - 1;
        lines[idx] = op.suffix + lines[idx];
        firstChangedLine ??= op.anchor.line;
        break;
      }
      case "inline_after": {
        const { valid } = validateHash(op.anchor, lines);
        if (!valid) throw new HashlineError(
          `Anchor mismatch at line ${op.anchor.line} (expected hash ${op.anchor.hash})`,
          op.anchor,
          lines,
        );
        const idx = op.anchor.line - 1;
        lines[idx] = lines[idx] + op.suffix;
        firstChangedLine ??= op.anchor.line;
        break;
      }
      case "delete": {
        const fromLine = op.range.from.line;
        const toLine = op.range.to?.line ?? fromLine;
        // Validate hashes
        for (const l of [fromLine, toLine]) {
          const h = computeLineHash(l, lines[l - 1]!);
          if (l === fromLine && h !== op.range.from.hash || op.range.to && l === toLine && h !== op.range.to?.hash) {
            const expected = l === fromLine ? op.range.from.hash : op.range.to?.hash!;
            throw new HashlineError(
              `Hash mismatch at line ${l} in delete range: expected ${expected}, got ${h}`,
              { line: l, hash: expected },
              lines,
            );
          }
        }
        const count = toLine - fromLine + 1;
        lines.splice(fromLine - 1, count);
        firstChangedLine ??= fromLine;
        break;
      }
      case "replace": {
        const fromLine = op.range.from.line;
        const toLine = op.range.to?.line ?? fromLine;
        // Validate hashes
        const fh = computeLineHash(fromLine, lines[fromLine - 1]!);
        if (fh !== op.range.from.hash) {
          throw new HashlineError(
            `Hash mismatch at line ${fromLine} in replace range start: expected ${op.range.from.hash}, got ${fh}`,
            op.range.from,
            lines,
          );
        }
        if (op.range.to) {
          const th = computeLineHash(toLine, lines[toLine - 1]!);
          if (th !== op.range.to.hash) {
            throw new HashlineError(
              `Hash mismatch at line ${toLine} in replace range end: expected ${op.range.to.hash}, got ${th}`,
              op.range.to,
              lines,
            );
          }
        }
        const count = toLine - fromLine + 1;
        lines.splice(fromLine - 1, count);
        // If there's payload, insert it; otherwise it becomes blank
        if (op.text) {
          const payloadLines = op.text.split("\n");
          lines.splice(fromLine - 1, 0, ...payloadLines);
        } else {
          lines.splice(fromLine - 1, 0, "");
        }
        firstChangedLine ??= fromLine;
        break;
      }
      case "insert_before_bof": {
        const payload = op.text.split("\n");
        lines.splice(0, 0, ...payload);
        firstChangedLine ??= 1;
        break;
      }
      case "insert_after_bof": {
        const payload = op.text.split("\n");
        lines.splice(1, 0, ...payload);
        firstChangedLine ??= 1;
        break;
      }
      case "insert_before_eof": {
        const payload = op.text.split("\n");
        lines.splice(lines.length, 0, ...payload);
        firstChangedLine ??= lines.length - payload.length + 1;
        break;
      }
      case "insert_after_eof": {
        const payload = op.text.split("\n");
        lines.splice(lines.length, 0, ...payload);
        firstChangedLine ??= Math.max(1, lines.length - payload.length);
        break;
      }
    }
  }

  return { lines: lines, firstChangedLine, warnings };
}

function render_anchor(a: Anchor): string {
  return `@${a.line}${a.hash}` + (a.contentHint ? ` ${a.contentHint}` : "");
}

function render_edit(theme: Theme, result: ReturnType<typeof parseHashline>): string[] {
  const content: string[] = [];
  for (const warning of result.warnings) {
    content.push(theme.fg("error", warning));
  }
  for (const section of result.sections) {
    content.push(theme.fg("accent", section.path));
    for (const op of section.ops) {
      let line = "";
      let color: ThemeColor = "toolOutput";
      switch (op.kind) {
        case "insert_before": [line, color] = [`${render_anchor(op.anchor)} ${op.text}`, "toolDiffAdded"]; break;
        case "insert_after": [line, color] = [`${render_anchor(op.anchor)} ${op.text}`, "toolDiffAdded"]; break;
        case "delete": {
          const from = render_anchor(op.range.from);
          const to = op.range.to ? `..${render_anchor(op.range.to)}` : "";
          [line, color] = [`${from}${to}`, "toolDiffRemoved"];
          break;
        }
        case "replace": {
          const from = render_anchor(op.range.from);
          const to = op.range.to ? `..${render_anchor(op.range.to)}` : "";
          [line, color] = [`${from}${to} ${op.text}`, "toolDiffContext"];
          break;
        }
        case "insert_before_bof": [line, color] = [op.text, "toolDiffAdded"]; break;
        case "insert_after_bof": [line, color] = [op.text, "toolDiffAdded"]; break;
        case "insert_before_eof": [line, color] = [op.text, "toolDiffAdded"]; break;
        case "insert_after_eof": [line, color] = [op.text, "toolDiffAdded"]; break;
        case "inline_before": [line, color] = [`${render_anchor(op.anchor)} ${theme.fg("toolDiffAdded", op.suffix)}`, "toolDiffAdded"]; break;
        case "inline_after": [line, color] = [`${render_anchor(op.anchor)} ${theme.fg("toolDiffAdded", op.suffix)}`, "toolDiffAdded"]; break;
      }
      content.push(theme.fg("accent", op.kind) + " " + theme.fg(color, line));
    }
    for (const warning of section.warnings) {
      content.push(theme.fg("error", warning));
    }
  }
  return content;
}

/** Error class */
class HashlineError extends Error {
  constructor(
    message: string,
    readonly anchor: { line: number; hash: string },
    readonly fileLines: string[],
  ) {
    super(message);
    this.name = "HashlineError";
  }

  get displayMessage(): string {
    const ctx = formatMismatchContext(this.anchor, this.fileLines);
    return `${this.message}\n\nContext:\n${ctx}`;
  }
}

export function executeHashlineEdit(input: string): {headline: string, warnings: string[]}[] {
  const { sections, warnings: parseWarnings } = parseHashline(input);
  if (sections.length === 0) {
    throw new Error("No valid hashline edit sections found. Each section must start with `@PATH`.");
  }

  const results: {headline: string, warnings: string[]}[] = [];
  for (const section of sections) {
    const absolutePath = section.path;

    let source = "";
    let fileExists = true;
    try {
      source = readFileSync(absolutePath).toString();
    } catch (err) {
      if (!isEnoent(err)) {
        throw err;
      }
      // File doesn't exist - only allow create-like ops
      const hasAnchorEdit = section.ops.some(op => !["insert_before_bof", "insert_after_bof", "insert_before_eof", "insert_after_eof"].includes(op.kind));
      if (hasAnchorEdit) {
        throw new Error(`File not found: ${absolutePath}. Only BOF/EOF insertions are valid for new files.`);
      }
      fileExists = false;
    }

    const normalizedLines = source.split("\n");
    // Remove trailing empty line from split if the file ends with newline
    if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] === "" && source.endsWith("\n")) {
      normalizedLines.pop();
    }

    const result = applyHashlineEdits(normalizedLines, section.ops);
    const warnings = [...parseWarnings, ...result.warnings, ...section.warnings];

    const finalContent = result.lines.join("\n");

    let headline = section.path;
    if (normalizedLines.join("\n") === finalContent) {
      headline = "No changes to " + headline;
    } else {
      writeFileSync(absolutePath, finalContent);
      if (!fileExists) {
        headline = `Created ${headline}`;
      }
    }

    results.push({headline, warnings});
  }

  return results;
}

const READ_PROMPT = `Read a file and output its content with line numbers.

Use this tool to inspect a file before editing it with edit-hashline.
Each line is formatted as LINE|TEXT (hashes are hidden in output but used internally for anchoring).

Limitations:
- Maximum 100KB output.
- Binary files are detected and rejected.
- Very large files are truncated early.`;

const MAX_READ_SIZE = 100 * 1024;

async function executeHashlineRead(filePath: string, startLine?: number, endLine?: number): Promise<{
  lineNumber: number,
  lineText: string,
}[]> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (err) {
    if (isEnoent(err)) throw new Error(`File not found: ${filePath}`);
    throw err;
  }

  if (!fileStat.isFile()) throw new Error(`Not a file: ${filePath}`);

  const hasRange = startLine !== undefined || endLine !== undefined;
  if (!hasRange && fileStat.size > MAX_READ_SIZE) {
    throw new Error(`File too large (${fileStat.size} bytes, max ${MAX_READ_SIZE}). Specify start/end to read a portion.`);
  }

  const raw = await readFile(filePath, "utf8");

  const nullIdx = raw.indexOf("\0");
  if (nullIdx >= 0) {
    throw new Error(`Binary file detected (null byte at offset ${nullIdx})`);
  }

  const text = raw;
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "" && text.endsWith("\n")) {
    lines.pop();
  }

  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    return [];
  }

  // Apply line range slicing
  const fromLine = startLine ?? 1;
  const toLine = endLine ?? lines.length;
  if (fromLine < 1 || toLine > lines.length || fromLine > toLine) {
    throw new Error(`Invalid line range: ${fromLine}..${toLine} (file has ${lines.length} lines, valid range: 1..${lines.length}).`);
  }
  const sliced = lines.slice(fromLine - 1, toLine);
  const rangeInfo = hasRange ? ` (lines ${fromLine}..${toLine} of ${lines.length})` : "";
  const formatted = sliced.map((line, i) => formatHashLine(fromLine + i, line)).join("\n");
  // return `(${sliced.length} lines, ${raw.length} bytes)${rangeInfo}\n${formatted}`;
  return sliced.map((line, i) => ({
    lineNumber: fromLine + i,
    lineText: line,
  }));
}

const EDIT_PROMPT = `Your patch language is a compact, line-anchored edit format.

A patch contains one or more file sections. The first non-blank line of every edit section **MUST** be \`@PATH\`.
Operations reference lines in the file by their line number and hash, called "Anchors", e.g. \`5th\`, \`123ab\`.
You **MUST** copy them verbatim from the latest output for the file you're editing.

This format is purely textual. The tool has NO awareness of language, indentation, brackets, fences, or table widths. You are responsible for emitting valid syntax in your replacements/insertions.

<ops>
@PATH            header: subsequent ops apply to PATH
< ANCHOR         insert lines BEFORE the anchored line (or BOF); payload follows as \`${SEP}TEXT\` lines
+ ANCHOR         insert lines AFTER  the anchored line (or EOF); payload follows as \`${SEP}TEXT\` lines
- A..B           delete the line range (inclusive); \`- A\` for one line
= A..B           replace the range with payload \`${SEP}TEXT\` lines, or with one blank line if no payload follows
</ops>

<rules>
- Every line of inserted/replacement content **MUST** be emitted as a payload line starting with \`${SEP}\`.
- \`${SEP}\` is syntax, not content. The inserted text begins after the first \`${SEP}\`; use a bare \`${SEP}\` to insert a blank line.
- \`< A\` inserts before line A; \`+ A\` inserts after line A. \`< BOF\` / \`+ BOF\` both prepend; \`< EOF\` / \`+ EOF\` both append.
- \`= A..B\` replaces the inclusive range with the following payload lines. \`= A\` (or \`= A..B\`) with no payload blanks the range to a single empty line.
- \`- A..B\` deletes the inclusive range; omit \`..B\` for one line.
- \`= A..B\` deletes exactly the lines A through B, then inserts your payload at that position.
  If your payload has MORE lines than the range (B-A+1), the extra lines push existing
  content DOWN - they do NOT overwrite lines beyond B. This DUPLICATES the lines after B.
  If your payload has FEWER lines, a gap does NOT appear - lines shift up.
</rules>

<case file="a.ts">
${formatHashLine(1, "const DEF = \"guest\";")}
${formatHashLine(2, "")}
${formatHashLine(3, "export function label(name) {")}
${formatHashLine(4, "  const clean = name || DEF;")}
${formatHashLine(5, "  return clean.trim();")}
${formatHashLine(6, "}")}
</case>

<examples>
# Replace one line (preserve the leading tab from the original)
@a.ts
= 5${computeLineHash(5, "  return clean.trim();")}
${SEP}  return clean.trim().toUpperCase();

# Replace a contiguous range with multiple lines
@a.ts
= 3${computeLineHash(3, "export function label(name) {")}..6${computeLineHash(6, "}")}
${SEP}export function label(name: string): string {
${SEP}  const clean = (name || DEF).trim();
${SEP}  return clean.length === 0 ? DEF : clean.toUpperCase();
${SEP}}

# Insert BEFORE a line
@a.ts
< 5${computeLineHash(5, "  return clean.trim();")}
${SEP}  const debug = false;

# Insert AFTER a line
@a.ts
+ 4${computeLineHash(4, "  const clean = name || DEF;")}
${SEP}  if (clean.length === 0) return DEF;

# Append WITHIN a line
@a.ts
+ 4${computeLineHash(4, "  const clean = name || DEF;")}${SEP} // first run

# Append to end of file
@a.ts
+ EOF
${SEP}export const done = true;

# Delete a single line
@a.ts
- 2${computeLineHash(2, "")}

# Blank a line in place (no payload required)
@a.ts
= 2${computeLineHash(2, "")}
</examples>


<critical>
- Always copy anchors exactly from tool output, but **NEVER** include line content after the \`${SEP}\` separator in the op line.
- Only emit changed lines. Do not restate unchanged context as payload.
- Every inserted/replacement content line **MUST** start with \`${SEP}\`; raw content lines are invalid.
- Do not write unified diff syntax (\`@@\`, \`-OLD\`, \`+NEW\`).
- To replace a block, use one \`= A..B\` op followed by all replacement \`${SEP}TEXT\` payload lines.
- \`= A..B\` deletes the range; payload is what's written. If a payload edge line already exists immediately outside \`A..B\`, widen the range to cover it - otherwise it duplicates.
- For \`= A..B\`, verify that (B-A+1) matches your payload line count. If they differ, you're either duplicating (payload too long) or deleting unintended lines (payload too short).
</critical>
`;

const ReadParams = Type.Object({
  path: Type.String({ description: "Path to the file to read with hashline anchors" }),
  start: Type.Optional(Type.Number({ description: "1-based start line number (inclusive). Default is 1." })),
  end: Type.Optional(Type.Number({ description: "1-based end line number (inclusive). Default is last line." })),
});
type ReadResult = {
  lineNumber: number,
  lineText: string,
}[];

const EditParams = Type.Object({
  input: Type.String({ description: "Hashline edit patch text with @PATH headers and line-anchored ops" }),
});
type EditResult = {
  headline: string,
  warnings: string[],
}[];

export default function hashlineEditExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "hashline-read",
    label: "Read (Hashline)",
    description: READ_PROMPT,
    parameters: ReadParams,
    async execute(_toolCallId: string, {path, start, end}: Static<typeof ReadParams>, _signal: AbortSignal | undefined): Promise<AgentToolResult<ReadResult>> {
      const result = await executeHashlineRead(path, start, end);
      if (result.length === 0) {
        return {content: [{
          type: "text",
          text: `(empty file)`,
        }], details: result};
      }
      return {content: [{
        type: "text",
        text: result.map(({lineNumber, lineText}) => formatHashLine(lineNumber, lineText)).join("\n"),
      }], details: result};
    },
    renderCall(args, theme, context) {
      const text = context.lastComponent as Text ?? new Text("", 0, 0);
      let content = `${theme.fg("toolTitle", theme.bold("hashline-read"))} ${theme.fg("accent", args.path)}`;
      if (args.start !== undefined) {
        content += ` (start ${args.start})`;
      }
      if (args.end !== undefined) {
        content += ` (end ${args.end})`;
      }
      text.setText(content);
      return text;
    },
  });

  pi.registerTool({
    name: "hashline-edit",
    label: "Edit",
    description: EDIT_PROMPT,
    parameters: EditParams,
    async execute(_toolCallId: string, {input}: Static<typeof EditParams>, _signal: AbortSignal | undefined): Promise<AgentToolResult<EditResult>> {
      const result = executeHashlineEdit(input);
      return {content: [{
        type: "text",
        text: result.map(({headline, warnings}) => `${headline}${warnings.length > 0 ? `\n\nWarnings:\n${warnings.join("\n")}` : ""}`).join("\n\n"),
      }], details: result};
    },
    renderCall(args, theme, context) {
      const text = context.lastComponent as Text ?? new Text("", 0, 0);

      const content = [];
      content.push(theme.fg("toolTitle", theme.bold("hashline-edit")));
      content.push(args.input);
      content.push("");

      text.setText(content.join("\n"));
      return text;
    },
    renderResult(result, options, theme, context) {
      const text = context.lastComponent as Text ?? new Text("", 0, 0);

      const content = [];
      content.push(...render_edit(theme, parseHashline(context.args.input)));
      for (const section of result.details) {
        if (section.warnings.length === 0) {
          continue;
        }
        content.push(theme.fg("accent", section.headline));
        for (const warning of section.warnings) {
          content.push(theme.fg("error", warning));
        }
      }

      text.setText(content.join("\n"));
      return text;
    },
  });
}
