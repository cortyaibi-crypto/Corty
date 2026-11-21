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
const { openSync, readSync, writeSync, writevSync, closeSync, fstatSync } = require('node:fs');

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
  for (let i = 0; i < 175; i++) text += rows;
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
function answersBytes(src) {
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
function answersToFile(inPath, outPath) {
  init();
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
        writevSync(ofd, out);
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

module.exports = { answersToFile, answersBytes };
