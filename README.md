# cortyaibi-crypto/Corty

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/cortyaibi-crypto/Corty/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/cortyaibi-crypto/Corty/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own `csv-reader 1.0.0`. `solve.js` exports `run(input)`, which returns
exactly the JSON value `{columns, rows, errors}` that `csv-reader 1.0.0` returns for a case's
`{text, header}` — the same records, the same broken-row errors, code unit for code unit — while
reading the text with `charCodeAt` scans and `slice` instead of building every field one character at
a time:

- an unquoted field is one scan for the next `,`, LF or CR and one slice;
- a quoted field with no line break and no doubled quote inside it is one scan and one slice;
- the general paths (a doubled quote, a line break inside quotes, junk after a closing quote, a quote
  that never closes) follow the reference's policy step for step.

`main.ts` is the driver the harness runs: it answers every case of `/input/cases.json` with `run` and
writes `/output/answers.json`.

On the kit's practice set (6 cases, 10.3 MB of CSV, node 22.23.4, one CPU, V8's incremental marking
off as the driver sets it) the entry answers every case identically in about 0.48 s of CPU against
`csv-reader`'s 1.05 s, roughly 2.2x faster.

## Run it

```sh
node /bot/main.ts
```

Locally, point it at a case set and an output directory:

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
