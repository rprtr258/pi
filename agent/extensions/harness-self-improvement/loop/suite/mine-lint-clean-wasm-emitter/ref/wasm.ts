// ef — minimal WebAssembly module emitter

export type SectionId = 1 | 3 | 7 | 10;

const MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
const VERSION = new Uint8Array([0x01, 0x00, 0x00, 0x00]);

function unsignedLeb128(n: number): Uint8Array {
  const out: number[] = [];
  let v = n;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return new Uint8Array(out);
}

function section(id: SectionId, payload: Uint8Array): Uint8Array {
  const header = unsignedLeb128(id);
  const len = unsignedLeb128(payload.length);
  const out = new Uint8Array(header.length + len.length + payload.length);
  out.set(header, 0);
  out.set(len, header.length);
  out.set(payload, header.length + len.length);
  return out;
}

export function typeSection(params: number[], results: number[]): Uint8Array {
  const body: number[] = [params.length, ...params, results.length, ...results];
  return section(1, new Uint8Array(body));
}

export function exportSection(name: string, index: number): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const body = new Uint8Array(1 + nameBytes.length + 1);
  body[0] = nameBytes.length;
  body.set(nameBytes, 1);
  body[1 + nameBytes.length] = 0x00; // func
  const withIndex = new Uint8Array(body.length + 1);
  withIndex.set(body, 0);
  withIndex[body.length] = index;
  return section(7, withIndex);
}

export function emitModule(sections: Uint8Array[]): Uint8Array {
  const total =
    MAGIC.length + VERSION.length + sections.reduce((a, s) => a + s.length, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  out.set(VERSION, MAGIC.length);
  let off = MAGIC.length + VERSION.length;
  for (const s of sections) {
    out.set(s, off);
    off += s.length;
  }
  return out;
}
