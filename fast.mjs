// Byte-level csv-reader 1.0.0 drop-in: cases.json's bytes in, answers.json's bytes out, through WASM v128 SIMD.
//
// A case's text arrives JSON-escaped inside cases.json, which is already the form a JSON answer wants: a field's bytes
// are copied as they stand and only the CSV layer's own rewrites touch them (a doubled quote to one, a CR inside
// quotes to LF, a stray CR dropped, a line break ending the field). Nothing is decoded to UTF-16, no JSON.parse, no
// JSON.stringify. Inside a text literal no raw quote byte can appear (every quote is \"), so the literal's end is a
// raw quote outside an escape.
//
// The module (csv2.wat, built with wabt) is resumable: it reads cases.json in whatever window the driver hands it and
// writes each case's answer into fixed regions of its own memory, so the file is read in small reusable chunks and no
// large buffer is ever faulted in. Its inner loop is one 16-byte load, one 16-byte store and one SIMD test a block,
// with the store rewound to the block's first comma, backslash or quote.
import { openSync, readSync, writeSync, closeSync, fstatSync } from 'node:fs';

const B64 = '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';

// The module's memory layout, as csv2.wat has it.
const BASE_COL = 524288;
const BASE_ROWS = 1048576;
const BASE_ERRBUF = 9437184;
const BASE_IN = 10485760;
const CHUNK = Number(process.env.CSV_CHUNK ?? 786432);

let mem = null;
let ex = null;

function init() {
  if (ex !== null) return ex;
  ex = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(B64, 'base64')), {}).exports;
  mem = ex.m;
  return ex;
}

/** A small cases.json of plain, quoted and multi-line fields: the loop's own shapes, to get them compiled once. */
function warmBytes() {
  const rows = [
    'a,b,c,dd,eee,f,7,8,9',
    '"x,y","q""r",z,1,2,3,4,5,6',
    '"n\nm",o,p,1,2,3,4,5,6',
    '-1,2.50,2026-01-02,AB-1234,word,phrase here,#42,50%,x_1,A&B',
  ].join('\n') + '\n';
  let text = 'h1,h2,h3,h4,h5,h6,h7,h8,h9,h10\n';
  for (let i = 0; i < 700; i++) text += rows;
  return Buffer.from(JSON.stringify([{ id: 'warm', input: { text, header: true } }]), 'utf8');
}

/** Run the reader once over a small text, so V8's optimizing compiler has the loop before the real file. */
function warm() {
  const src = warmBytes();
  need(BASE_IN + src.length + 64);
  Buffer.from(mem.buffer, BASE_IN, src.length).set(src);
  ex.p.value = BASE_IN;
  ex.e.value = BASE_IN + src.length;
  ex.eof.value = 1;
  ex.st.value = 0;
  for (;;) {
    const r = ex.step();
    if (r === 2) break;
    if (r === 1) continue;
    break;
  }
  ex.p.value = BASE_IN;
  ex.e.value = BASE_IN;
  ex.eof.value = 0;
  ex.st.value = 0;
  ex.fail.value = 0;
}

function need(bytes) {
  const have = mem.buffer.byteLength;
  if (bytes > have) mem.grow(Math.ceil((bytes - have) / 65536));
}

/** The case just read, as answers.json holds it, appended to `out`: buffers over the module's memory, no copies. */
function caseParts(out) {
  const hdr = ex.hdr.value;
  const nrec = ex.nrec.value;
  const colLen = ex.colLen.value;
  const rowLen = ex.rowLen.value;
  const errLen = ex.errLen.value;
  const view = mem.buffer;
  const col = Buffer.from(view, BASE_COL, colLen);
  const rows = Buffer.from(view, BASE_ROWS, rowLen);
  const errs = Buffer.from(view, BASE_ERRBUF, errLen);
  if (nrec === 0) {
    out.push(Buffer.from('{"columns":' + (hdr === 1 ? '[]' : 'null') + ',"rows":[],"errors":['));
    out.push(errs);
    out.push(Buffer.from(']}'));
    return;
  }
  if (hdr === 1) {
    out.push(Buffer.from('{"columns":['));
    out.push(col);
    out.push(Buffer.from('],"rows":['));
    out.push(rows);
  } else {
    out.push(Buffer.from('{"columns":null,"rows":[['));
    out.push(col);
    out.push(Buffer.from(rowLen > 0 ? '],' : ']'));
    if (rowLen > 0) out.push(rows);
  }
  out.push(Buffer.from('],"errors":['));
  out.push(errs);
  out.push(Buffer.from(']}'));
}

/** Every case's answer, one JSON array: the answers.json bytes for `src`. Throws when the file is not as expected. */
export function answersBytes(src) {
  init();
  const n = src.length;
  need(BASE_IN + n + 64);
  Buffer.from(mem.buffer, BASE_IN, n).set(src);
  ex.p.value = BASE_IN;
  ex.e.value = BASE_IN + n;
  ex.eof.value = 1;
  ex.st.value = 0;
  const out = [Buffer.from('[')];
  for (let i = 0; ; i++) {
    const r = ex.step();
    if (r === 2) break;
    if (r === 1) {
      if (i > 0) out.push(Buffer.from(','));
      const parts = [];
      caseParts(parts);
      for (const b of parts) out.push(Buffer.from(b));
      continue;
    }
    throw new Error('csv reader: the bytes are not as expected (' + r + ')');
  }
  if (out.length === 1) throw new Error('cases.json: no cases');
  out.push(Buffer.from(']'));
  return Buffer.concat(out);
}

/** The answers for every case of the file at `inPath`, written to `outPath`. */
export function answersToFile(inPath, outPath) {
  init();
  warm();
  const fd = openSync(inPath, 'r');
  const size = fstatSync(fd).size;
  const ofd = openSync(outPath, 'w');
  need(BASE_IN + CHUNK);
  let pos = 0;      // bytes read from the file
  let filled = 0;   // bytes in the window at BASE_IN
  let eof = 0;
  ex.p.value = BASE_IN;
  ex.e.value = BASE_IN;
  ex.eof.value = 0;
  ex.st.value = 0;

  const refill = () => {
    const p0 = ex.p.value;
    let hold = p0;
    if (ex.ckLive.value === 1 && ex.ckP.value < hold) {
      if (p0 - ex.ckP.value > 65536) throw new Error('csv reader: a quoted field spans too much of the file');
      hold = ex.ckP.value;
    }
    const tail = BASE_IN + filled - hold;
    if (hold !== BASE_IN) {
      Buffer.from(mem.buffer, hold, tail).copy(Buffer.from(mem.buffer, BASE_IN, tail));
      ex.p.value = BASE_IN + (p0 - hold);
      if (ex.ckLive.value === 1) ex.ckP.value = BASE_IN + (ex.ckP.value - hold);
    }
    const room = CHUNK - tail;
    if (room < 16) throw new Error('csv reader: the window is full');
    const n = readSync(fd, Buffer.from(mem.buffer, BASE_IN + tail, room), 0, room, pos);
    pos += n;
    filled = tail + n;
    ex.e.value = BASE_IN + filled;
    if (n === 0) {
      eof = 1;
      ex.eof.value = 1;
    }
  };

  try {
    writeSync(ofd, Buffer.from('['));
    let first = true;
    let lastP = -1;
    for (;;) {
      const r = ex.step();
      if (r === 0) {
        if (eof !== 0 && ex.p.value === lastP) throw new Error('csv reader: the bytes are not as expected');
        refill();
        if (eof === 1 && ex.p.value === lastP) throw new Error('csv reader: the bytes are not as expected');
        lastP = ex.p.value;
        continue;
      }
      if (r === 1) {
        if (!first) writeSync(ofd, Buffer.from(','));
        const out = [];
        caseParts(out);
        for (const b of out) writeSync(ofd, b);
        first = false;
        lastP = -1;
        continue;
      }
      if (r === 2) break;
      throw new Error('csv reader: the bytes are not as expected (' + r + ')');
    }
    if (first) throw new Error('cases.json: no cases');
    writeSync(ofd, Buffer.from(']'));
  } finally {
    closeSync(fd);
    closeSync(ofd);
  }
  return 1;
}
