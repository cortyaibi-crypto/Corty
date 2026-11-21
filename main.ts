// Driver: reads every case from /input/cases.json and writes /output/answers.json.
//
// fast.mjs is the reader: it turns cases.json's bytes straight into the answer's bytes through a WASM v128 module,
// copying each field's JSON-escaped bytes as they stand (no JSON.parse, no JSON.stringify, no UTF-16 string).
// If anything about the file is not what the reader expects, the driver falls back to reading the file with
// JSON.parse and answering each case with run() from solve.js, the same entry the answer must equal.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Set before anything is imported, as the house baseline sets its flag.
try {
  setFlagsFromString('--no-incremental-marking');
} catch {}
try {
  setFlagsFromString('--no-lazy-feedback-allocation');
} catch {}

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const input = join(INPUT_DIR, 'cases.json');
const output = join(OUTPUT_DIR, 'answers.json');

let done = false;
try {
  const { answersToFile } = (await import(new URL('./fast.mjs', import.meta.url).href)) as {
    answersToFile: (a: string, b: string) => number;
  };
  answersToFile(input, output);
  done = true;
} catch {}

if (!done) {
  const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
    run: (input: unknown) => unknown;
  };
  const cases = JSON.parse(readFileSync(input, 'utf8')) as { id: string; input: unknown }[];
  writeFileSync(output, JSON.stringify(cases.map((c) => run(c.input))));
}
