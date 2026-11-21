// Byte-level csv-reader 1.0.0 drop-in: cases.json's bytes in, answers.json's bytes out, through WASM v128 SIMD.
//
// A case's text arrives JSON-escaped inside cases.json, which is already the form a JSON answer wants: a field's bytes
// are copied as they stand and only the CSV layer's own rewrites touch them (a doubled quote to one, a CR inside
// quotes to LF, a stray CR dropped, a line break ending the field). Nothing is decoded to UTF-16, no JSON.parse, no
// JSON.stringify. Inside a text literal no raw quote byte can appear (every quote is \"), so the literal's end is a
// raw quote outside an escape.
//
// The module below is the reader itself (csv.wat, compiled with wabt): every 16-byte block of a text is loaded once,
// stored once and tested once for a comma or a backslash with v128 SIMD, so a field costs one block test and one copy
// rather than a character at a time. Its scratch layout: errors at 0 (65536 records of 24 bytes), long_row extra bytes
// at 1572864, columns at 3670016, literal strings at 4718592, the input at IN_PTR, then one case's answer at OUT_PTR.
// Each case is answered into that one buffer and written out at once, so an answer's bytes are touched once.
import { openSync, readSync, writeSync, closeSync, fstatSync } from 'node:fs';

const B64 = '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';

const IN_PTR = 5242880;
const PAGE = 65536;

let mem = null;
let ex = null;

/** The module, made once, and its memory grown to hold `bytes`. */
function setup(bytes) {
  if (ex === null) {
    ex = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(B64, 'base64')), {}).exports;
    mem = ex.m;
  }
  const pages = Math.ceil(bytes / PAGE);
  const have = mem.buffer.byteLength / PAGE;
  if (pages > have) mem.grow(pages - have);
  return ex;
}

/** Every case's answer, concatenated as answers.json holds them, in one Buffer. Throws when the file is not as expected. */
export function answersBytes(src) {
  const inLen = src.length;
  const outPtr = IN_PTR + ((inLen + 63) & ~63);
  const end = IN_PTR + inLen;
  const e = setup(outPtr + 65536);
  Buffer.from(mem.buffer, IN_PTR, inLen).set(src);
  const parts = [];
  let q = IN_PTR;
  for (;;) {
    const a = e.findcase(q, end);
    if (a < 0) break;
    const textEnd = e.aend.value;
    const hdr = e.hdrg.value;
    setup(outPtr + 6 * (textEnd - a) + 4194304);
    const endW = e.conv(a, textEnd, hdr, outPtr);
    if (endW < 0) throw new Error('cases.json: the reader could not place its bytes');
    parts.push(Buffer.from(new Uint8Array(mem.buffer, outPtr, endW - outPtr)));
    q = textEnd + 12;
  }
  if (parts.length === 0) throw new Error('cases.json: no cases');
  return Buffer.concat([Buffer.from('['), ...parts.flatMap((p, i) => (i === 0 ? [p] : [Buffer.from(','), p])), Buffer.from(']')]);
}

/** The answers for every case of the file at `inPath`, written to `outPath`; read and written through the module's memory. */
export function answersToFile(inPath, outPath) {
  const fd = openSync(inPath, 'r');
  const size = fstatSync(fd).size;
  const outPtr = IN_PTR + ((size + 63) & ~63);
  const end = IN_PTR + size;
  const e = setup(outPtr + 65536);
  const inView = Buffer.from(mem.buffer, IN_PTR, size);
  let off = 0;
  while (off < size) {
    const n = readSync(fd, inView, off, size - off, off);
    if (n <= 0) break;
    off += n;
  }
  closeSync(fd);
  if (off !== size) throw new Error('cases.json: read short');
  const out = openSync(outPath, 'w');
  try {
    let q = IN_PTR;
    let cases = 0;
    for (;;) {
      const a = e.findcase(q, end);
      if (a < 0) break;
      const textEnd = e.aend.value;
      const hdr = e.hdrg.value;
      setup(outPtr + 6 * (textEnd - a) + 4194304);
      const endW = e.conv(a, textEnd, hdr, outPtr);
      if (endW < 0) throw new Error('cases.json: the reader could not place its bytes');
      if (cases === 0) writeSync(out, '[');
      else writeSync(out, ',');
      writeSync(out, Buffer.from(mem.buffer, outPtr, endW - outPtr));
      cases++;
      q = textEnd + 12;
    }
    if (cases === 0) throw new Error('cases.json: no cases');
    writeSync(out, ']');
  } finally {
    closeSync(out);
  }
  return 1;
}
