// The program the harness runs: cases.json's bytes to answers.json's bytes, through the module in m.mjs.
//
// m.mjs reads the file in windows and answers each case as it ends, without JSON.parse, JSON.stringify or any
// UTF-16 string. If anything about the file is not what it expects, the answers are made the slow way instead:
// solve.js's run() on every case, which is csv-reader 1.0.0's own reading.
import { readFileSync, writeFileSync } from 'node:fs';
import { answersToFile } from './m.mjs';

const input = (process.env.MAKEFUN_INPUT_DIR ?? '/input') + '/cases.json';
const output = (process.env.MAKEFUN_OUTPUT_DIR ?? '/output') + '/answers.json';

let done = false;
try {
  answersToFile(input, output);
  done = true;
} catch {}

if (!done) {
  const { run } = (await import('./solve.js')) as { run: (input: unknown) => unknown };
  const cases = JSON.parse(readFileSync(input, 'utf8')) as { id: string; input: unknown }[];
  writeFileSync(output, JSON.stringify(cases.map((c) => run(c.input))));
}
// every write above is synchronous: leave without waiting on the loop
process.exit(0);
