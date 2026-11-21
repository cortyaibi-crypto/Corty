// The program the harness runs. main.ts is a symbolic link to this file, so node reads the path it points at
// (a .cjs file) and loads it as the CommonJS it is; were the link ever copied as a plain file, this same text
// still runs, as an ES module (nothing here is CommonJS-only: no require, no module, no __dirname).
//
// It answers cases.json's bytes to answers.json's bytes through m.cjs — no JSON.parse, no JSON.stringify, no
// UTF-16 string. If anything about the file is not what the reader expects, the answers are made the slow way
// instead: solve's run() on every case, which is csv-reader 1.0.0's own reading.
function answers(fs, reader, solve) {
  const input = (process.env.MAKEFUN_INPUT_DIR ?? '/input') + '/cases.json';
  const output = (process.env.MAKEFUN_OUTPUT_DIR ?? '/output') + '/answers.json';
  try {
    reader.answersToFile(input, output);
    process.exit(0);
  } catch {}
  Promise.resolve(solve()).then(({ run }) => {
    const cases = JSON.parse(fs.readFileSync(input, 'utf8'));
    fs.writeFileSync(output, JSON.stringify(cases.map((c) => run(c.input))));
    process.exit(0);
  });
}

if (typeof require === 'function') {
  answers(require('node:fs'), require('./m.cjs'), () => require('./solve.cjs'));
} else {
  Promise.all([import('node:fs'), import('./m.cjs')]).then(([fs, reader]) =>
    answers(fs, reader, () => import('./solve.js')));
}
