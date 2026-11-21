# cortyaibi-crypto/Corty

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/cortyaibi-crypto/Corty/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/cortyaibi-crypto/Corty/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/cortyaibi-crypto/Corty?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own `csv-reader 1.0.0`. `solve.js` exports `run(input)`, which returns
exactly the JSON value `{columns, rows, errors}` that `csv-reader 1.0.0` returns for a case's
`{text, header}` — the same records, the same broken-row errors, code unit for code unit.

## How it is faster

`main.ts` answers the cases from `cases.json`'s **bytes**, through `fast.mjs`:

- A case's text is already JSON-escaped inside `cases.json`, and that is exactly the form a JSON answer
  wants — so a field's bytes are copied as they stand rather than decoded to UTF-16, parsed into
  strings and escaped again. There is no `JSON.parse` of the input and no `JSON.stringify` of the
  answers; only the CSV layer's own rewrites touch the bytes (a doubled quote to one, a CR inside
  quotes to LF, a stray CR dropped, a line break ending the field).
- Within a text literal no raw quote byte can appear (every quote is `\"` there), so a field's end, a
  record's end and the literal's own end are all found on the escaped bytes directly.
- Between two escapes a field is a plain run of bytes, copied whole with `Buffer#copy`; the escapes are
  the only places the reader looks at a byte at a time.
- The reader is split into small functions on purpose: the entry runs once, so what V8 spends
  compiling a function is part of the measured run, and a small function costs a millisecond or two
  where one large one costs tens. A short warm-up (a few hundred bytes that take every branch) gives
  the reader its feedback before the real cases run through it, so it is compiled once and not
  recompiled mid-run.

`solve.js` stays the readable drop-in: `run(input)` on a decoded `{text, header}` returns the
reference's answer. `main.ts` uses it as the fallback whenever `cases.json` is not the shape `fast.mjs`
expects.

## Measurements

Kit practice set: 6 cases, 10.3 MB of CSV, node 22.23.4, one CPU, CPU time of the whole run
(startup included), best of three:

| entry | CPU time |
| --- | --- |
| the house baseline (`csv-reader 1.0.0` behind its driver) | 1.16 s |
| the previous entry (`charCodeAt` scans and `slice`, then `JSON.stringify`) | 0.50 s |
| this entry (byte-level, `fast.mjs`) | 0.20 s |

Equivalence was checked against `csv-reader 1.0.0` itself: the kit's practice set, freshly drawn
instances from the kit's generator, and 12,000 random and structured fuzz texts (quotes, doubled
quotes, junk after a closing quote, quotes that never close, lone CRs, CRLF, blank lines, BOMs, empty
texts, ragged rows) — every answer identical, key order aside.

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
