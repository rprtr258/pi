/**
 * Tests for hashline-edit extension.
 *
 * Run: bun test
 */
import {describe, it, expect} from "bun:test";
import {mkdtempSync, writeFileSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {xxh32 as xxHash32} from "xxh32";
import {parseHashline, executeHashlineEdit} from "./index";

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

function computeLineHash(line: string, index: number): string {
	const RE_SIGNIFICANT = /[\p{L}\p{N}]/u;
	const seed = RE_SIGNIFICANT.test(line) ? 0 : index;
	return (BIGRAMS as readonly string[])[xxHash32(line, seed) % BIGRAMS.length]!;
}

// Return correct anchors for each line
function getAnchors(content: string): string[] {
	return content.split("\n").map((line, i) => computeLineHash(line, i + 1));
}

function withTempFile(content: string, fn: (path: string, anchors: string[]) => void) {
	const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));
	const filePath = join(dir, "test.ts");
	writeFileSync(filePath, content);
	const anchors = getAnchors(content);
	try {
		fn(filePath, anchors);
	} finally {}
}

describe("xxHash32", () => {
	it("is deterministic", () => {
		expect(xxHash32("hello")).toBe(xxHash32("hello"));
	});

	it("differs for different inputs", () => {
		expect(xxHash32("hello")).not.toBe(xxHash32("world"));
	});

	it("handles empty string", () => {
		const r = xxHash32("");
		expect(typeof r).toBe("number");
		expect(Number.isFinite(r)).toBe(true);
	});

	it("handles Unicode", () => {
		const r = xxHash32("héllo wörld 🎉");
		expect(Number.isFinite(r)).toBe(true);
	});

	it("supports custom seeds", () => {
		expect(xxHash32("abc", 0)).not.toBe(xxHash32("abc", 1));
	});

	it("handles long strings (>16 bytes)", () => {
		expect(Number.isFinite(xxHash32("a".repeat(100)))).toBe(true);
	});

	it("stays within Uint32 range", () => {
		for (const s of ["", "a", "ab", "hello", "a".repeat(50)]) {
			const h = xxHash32(s);
			expect(h).toBeGreaterThanOrEqual(0);
			expect(h).toBeLessThanOrEqual(0xffffffff);
		}
	});
});

describe("parseHashline", () => {
	it("parses @PATH header", () => {
		const {sections, warnings} = parseHashline("@hello.ts");
		expect(warnings).toEqual([]);
		expect(sections).toHaveLength(1);
		expect(sections[0]!.path).toBe("hello.ts");
	});

	it("parses quoted paths", () => {
		const {sections} = parseHashline(`@"hello world.ts"`);
		expect(sections[0]!.path).toBe("hello world.ts");
	});

	it("parses single-quoted paths", () => {
		const {sections} = parseHashline(`@'hello world.ts'`);
		expect(sections[0]!.path).toBe("hello world.ts");
	});

	it("skips blank/comment lines", () => {
		const {sections, warnings} = parseHashline("# comment\n  \n@f.ts");
		expect(warnings).toEqual([]);
		expect(sections).toHaveLength(1);
	});

	it("warns on unrecognized ops", () => {
		const {warnings} = parseHashline("@f.ts\nblah blah");
		expect(warnings.length).toBeGreaterThan(0);
	});

	it("parses = A..B with payload", () => {
		const input = "@f.ts\n= 3aa..5bb\n~line1\n~line2";
		const {sections} = parseHashline(input);
		const op = sections[0]!.ops[0]!;
		expect(op.kind).toBe("replace");
		if (op.kind === "replace") {
			expect(op.range.from.line).toBe(3);
			expect(op.range.from.hash).toBe("aa");
			expect(op.range.to!.line).toBe(5);
			expect(op.range.to!.hash).toBe("bb");
			expect(op.text).toBe("line1\nline2");
		}
	});

	it("parses = A (single line, no payload → blanks)", () => {
		const input = "@f.ts\n= 7zz";
		const {sections} = parseHashline(input);
		const op = sections[0]!.ops[0]!;
		expect(op.kind).toBe("replace");
		if (op.kind === "replace") {
			expect(op.range.from.line).toBe(7);
			expect(op.range.to).toBeUndefined();
			expect(op.text).toBe("");
		}
	});

	it("parses - A..B (delete range)", () => {
		const input = "@f.ts\n- 1aa..3cc";
		const {sections} = parseHashline(input);
		const op = sections[0]!.ops[0]!;
		expect(op.kind).toBe("delete");
		if (op.kind === "delete") {
			expect(op.range.from.line).toBe(1);
			expect(op.range.to!.line).toBe(3);
		}
	});

	it("parses - A (delete single)", () => {
		const input = "@f.ts\n- 5xy";
		const {sections} = parseHashline(input);
		expect(sections[0]!.ops[0]!.kind).toBe("delete");
	});

	it("parses < line (insert before)", () => {
		const input = "@f.ts\n< 2ab\n~inserted";
		const {sections} = parseHashline(input);
		const op = sections[0]!.ops[0]!;
		expect(op.kind).toBe("insert_before");
		if (op.kind === "insert_before") {
			expect(op.anchor.line).toBe(2);
			expect(op.text).toBe("inserted");
		}
	});

	it("parses + line (insert after)", () => {
		const input = "@f.ts\n+ 4zz\n~after";
		const {sections} = parseHashline(input);
		const op = sections[0]!.ops[0]!;
		expect(op.kind).toBe("insert_after");
		if (op.kind === "insert_after") {
			expect(op.anchor.line).toBe(4);
			expect(op.text).toBe("after");
		}
	});

	it("parses < BOF", () => {
		const {sections} = parseHashline("@f.ts\n< BOF\n~x");
		expect(sections[0]!.ops[0]!.kind).toBe("insert_before_bof");
	});

	it("parses + BOF", () => {
		const {sections} = parseHashline("@f.ts\n+ BOF\n~x");
		expect(sections[0]!.ops[0]!.kind).toBe("insert_after_bof");
	});

	it("parses < EOF", () => {
		const {sections} = parseHashline("@f.ts\n< EOF\n~x");
		expect(sections[0]!.ops[0]!.kind).toBe("insert_before_eof");
	});

	it("parses + EOF", () => {
		const {sections} = parseHashline("@f.ts\n+ EOF\n~x");
		expect(sections[0]!.ops[0]!.kind).toBe("insert_after_eof");
	});

	it("parses inline + ANCHOR~text", () => {
		const input = "@f.ts\n+ 3xy~ // comment";
		const {sections} = parseHashline(input);
		const op = sections[0]!.ops[0]!;
		expect(op.kind).toBe("inline_after");
		if (op.kind === "inline_after") {
			expect(op.suffix).toBe(" // comment");
		}
	});

	it("parses inline < ANCHOR~text", () => {
		const input = "@f.ts\n< 3xy~export ";
		const {sections} = parseHashline(input);
		const op = sections[0]!.ops[0]!;
		expect(op.kind).toBe("inline_before");
		if (op.kind === "inline_before") {
			expect(op.suffix).toBe("export");
		}
	});

	it("handles multiple sections", () => {
		const input = "@a.ts\n= 1a\n~x\n@b.ts\n+ 2b\n~y";
		const {sections} = parseHashline(input);
		expect(sections).toHaveLength(2);
		expect(sections[0]!.path).toBe("a.ts");
		expect(sections[1]!.path).toBe("b.ts");
	});

	it("warns on invalid op syntax", () => {
		const {warnings} = parseHashline("@f.ts\n? 1aa");
		expect(warnings.length).toBeGreaterThan(0);
	});
});

describe("executeHashlineEdit", () => {
	it("throws on empty input", () => {
		expect(() => executeHashlineEdit("")).toThrow("No valid hashline edit sections found");
	});

	it("throws on sections with no @PATH", () => {
		expect(() => executeHashlineEdit("= 1aa")).toThrow();
	});

	it("replaces a single line", () => {
		withTempFile("a\nb\nc", (path, a) => {
			const patch = `@${path}\n= 1${a[0]!}\n~X`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("X\nb\nc");
		});
	});

	it("replaces a range of lines", () => {
		withTempFile("a\nb\nc\nd", (path, a) => {
			const patch = `@${path}\n= 2${a[1]!}..4${a[3]!}\n~X\n~Y\n~Z`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("a\nX\nY\nZ");
		});
	});

	it("reports no changes when content is identical", () => {
		withTempFile("same", (path, a) => {
			const patch = `@${path}\n= 1${a[0]!}\n~same`;
			const results = executeHashlineEdit(patch);
			expect(results[0]!.headline).toContain("No changes");
		});
	});

	it("inserts before a line", () => {
		withTempFile("a\nb\nc", (path, a) => {
			const patch = `@${path}\n< 2${a[1]!}\n~X`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("a\nX\nb\nc");
		});
	});

	it("inserts after a line", () => {
		withTempFile("a\nb\nc", (path, a) => {
			const patch = `@${path}\n+ 2${a[1]!}\n~X`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("a\nb\nX\nc");
		});
	});

	it("deletes a single line", () => {
		withTempFile("a\nb\nc", (path, a) => {
			const patch = `@${path}\n- 2${a[1]!}`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("a\nc");
		});
	});

	it("deletes a range", () => {
		withTempFile("a\nb\nc\nd", (path, a) => {
			const patch = `@${path}\n- 2${a[1]!}..3${a[2]!}`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("a\nd");
		});
	});

	it("inserts at BOF and EOF", () => {
		withTempFile("middle", (path, _a) => {
			const patch = `@${path}\n< BOF\n~first\n+ EOF\n~last`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("first\nmiddle\nlast");
		});
	});

	it("throws HashlineError on hash mismatch", () => {
		withTempFile("a\nb", (path, _a) => {
			const patch = `@${path}\n= 1xx\n~X`;
			expect(() => executeHashlineEdit(patch)).toThrow("Hash mismatch");
		});
	});

	it("throws on non-existent file", () => {
		const patch = "@/nonexistent/file.ts\n= 1aa\n~x";
		expect(() => executeHashlineEdit(patch)).toThrow("File not found");
	});

	it("allows BOF/EOF ops on new files", () => {
		const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));
		const filePath = join(dir, "new.ts");
		const patch = `@${filePath}\n< BOF\n~hello\n+ EOF\n~world`;
		executeHashlineEdit(patch);
		expect(readFileSync(filePath, "utf8")).toBe("hello\n\nworld");
	});

	it("handles multiple ops on same file", () => {
		withTempFile("a\nb\nc", (path, a) => {
			const patch = `@${path}\n= 1${a[0]!}\n~X\n+ EOF\n~added`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("X\nb\nc\nadded");
		});
	});

	it("blanks a line with no-payload replace", () => {
		withTempFile("a\nb\nc", (path, a) => {
			const patch = `@${path}\n= 2${a[1]!}`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("a\n\nc");
		});
	});

	it("handles file with trailing newline", () => {
		withTempFile("a\nb\n", (path, a) => {
			const patch = `@${path}\n= 1${a[0]!}\n~X`;
			executeHashlineEdit(patch);
			expect(readFileSync(path, "utf8")).toBe("X\nb");
		});
	});
});
