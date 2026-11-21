// Driver: reads every case from /input/cases.json and writes /output/answers.json.
//
// The answers are produced by fast.mjs, which reads cases.json's bytes straight into the answer's bytes: the case
// texts arrive JSON-escaped in that very file, so a field's bytes are copied as they stand and never decoded to
// UTF-16, re-escaped or re-serialised. Nothing here surprises V8: the flags below are the house baseline's, plus
// full feedback from the start, and a short warm-up gives every branch of the reader its feedback before the real
// cases run through it (what V8 spends compiling a function on first use is part of the measured run).
//
// If anything about the file is not what fast.mjs expects, the driver falls back to reading the file with
// JSON.parse and answering each case with run() from solve.js, the same entry the answer must equal.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Set before solve.js and fast.mjs are imported, as the house baseline sets its flag.
try {
  setFlagsFromString('--no-incremental-marking');
} catch {}
try {
  setFlagsFromString('--no-lazy-feedback-allocation');
} catch {}

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };
const { answersBytes } = (await import(new URL('./fast.mjs', import.meta.url).href)) as {
  answersBytes: (src: Buffer) => Buffer;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Small cases that between them take every branch of the reader: a BOM, CRLF and LF, a header and none, a doubled
// quote, a line break inside quotes, a lone CR, junk after a closing quote, a quote that never closes, a blank
// line, a short row, a long row, an empty field and a text that does not end in a line break.
const WARM = Buffer.from(
  JSON.stringify([
    {
      id: 'w1',
      input: {
        text: '\uFEFFa,b,c\r\n1,2,3\r\n"x,y","z""w",q\r\n\r\nr,"multi\rline",t\r\nshort\r\n1,2,3,4\r\n"junk"x,m\r\nk,\r,l\r\n',
        header: true,
      },
    },
    { id: 'w2', input: { text: 'a,b\n"open,never\ncloses,b\nc,d\n', header: false } },
    { id: 'w3', input: { text: '', header: true } },
    { id: 'w4', input: { text: '\r\r\n\n', header: false } },
    { id: 'w5', input: { text: 'h1,h2\n"",""\n,v\n"a""b","c\rd"\nlast,row', header: true } },
  ]),
);

const src = readFileSync(join(INPUT_DIR, 'cases.json'));

let answers: Buffer | null = null;
try {
  answersBytes(WARM);
  answers = answersBytes(src);
} catch {
  answers = null;
}

if (answers === null) {
  const cases = JSON.parse(src.toString('utf8')) as { id: string; input: unknown }[];
  answers = Buffer.from(JSON.stringify(cases.map((c) => run(c.input))), 'utf8');
}

writeFileSync(join(OUTPUT_DIR, 'answers.json'), answers);
