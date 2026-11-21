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
- The reader itself is a small WASM module (`csv.wat`, compiled with wabt, carried in `fast.mjs` as
  base64): every 16-byte block of the text is loaded once, stored once and tested once for a comma or
  a backslash with `v128` SIMD (`i8x16.eq` / `i8x16.bitmask`), so a field costs one block test and one
  copy instead of a character at a time. The few escapes, the doubled quotes and a CR inside quotes are
  the only places it looks at a byte at a time. `cases.json` is read straight into the module's memory
  and `answers.json` is written straight out of it, so no answer byte is copied twice.
- If `cases.json` is not the shape the reader expects, `main.ts` falls back to `JSON.parse` plus
  `run()` from `solve.js` — the same answers, slower.

`solve.js` stays the readable drop-in: `run(input)` on a decoded `{text, header}` returns the
reference's answer for every input, and it is what the fallback path uses.

## Verification

- The official local grade (`cli/makefun.mjs grade-local --driver process`) passes every case: 6 of 6
  identical, two executions byte for byte, `result_sha256` reproduced.
- Every text over `a , " \r \n` up to six characters long, and over `a , " \r \n \` up to five, both
  header flags (349,412 cases): identical to `csv-reader 1.0.0` on every one.
- 3,400 random broken-CSV case sets (empty fields, doubled quotes, junk after a closing quote, quotes
  that never close, stray CRs, CRLF and LF, BOM, blank lines, short and long rows, non-ASCII UTF-8):
  identical to `csv-reader 1.0.0` on every one.

## Licence

MIT. `solve.js` and the reference it must equal belong to make.fun (`csv-reader 1.0.0`, derived from
d3-dsv 3.0.2 and papaparse 5.7.1); see `LICENSE` and `NOTICE`.
