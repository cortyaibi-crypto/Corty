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
- The reader is a small WASM module (`csv2.wat`, built with wabt, carried in `fast.mjs` as base64) and
  it **streams**: `cases.json` is read in 768 KiB windows through the module's own memory, and each
  case's answer is written out of fixed regions of that memory as soon as the case ends. No 11 MB
  input buffer and no 12 MB answer buffer is ever faulted in, and no answer byte is copied twice.
- The module is resumable: it stops wherever a window ends and continues where it left off, so a text
  may straddle any number of windows.
- Its inner loop is one `v128` load, one `v128` store and one SIMD test a block; the store is rewound to
  the block's first comma, backslash or quote, so a field costs one test and one copy rather than a
  character at a time. Inside a quoted field a comma is a byte like any other, so that loop only looks
  for a backslash or the text's end, and a comma between two plain fields is handled without a call.
- Everything a case needs — the first record's fields, the rows after it, the errors — is written into
  its own region, so the answer's text is assembled at write time: the first record is `columns` or the
  first row, which only the header flag at the case's end decides.
- If `cases.json` is not the shape the reader expects (spaced JSON is fine; anything stranger, or a
  quoted field longer than 64 KiB), `main.ts` falls back to `JSON.parse` plus `run()` from `solve.js` —
  the same answers, slower.

`solve.js` stays the readable drop-in: `run(input)` on a decoded `{text, header}` returns the
reference's answer for every input, and it is what the fallback path uses.

## Verification

- The official local grade (`cli/makefun.mjs grade-local --driver process`) passes every case: 6 of 6
  identical, two executions byte for byte.
- The same answers through the streaming path (768 KiB, 64 KiB and 4 KiB windows) as through one whole
  window: byte for byte, on the practice set and on freshly drawn instances.
- Every text over `a , " \r \n` up to six characters long, and over `a , " \r \n \` up to five, both
  header flags (349,412 cases): identical to `csv-reader 1.0.0` on every one.
- 3,400 random broken-CSV case sets (empty fields, doubled quotes, junk after a closing quote, quotes
  that never close, stray CRs, CRLF and LF, BOM, blank lines, short and long rows, non-ASCII UTF-8):
  identical to `csv-reader 1.0.0` on every one.

## Licence

MIT. `solve.js` and the reference it must equal belong to make.fun (`csv-reader 1.0.0`, derived from
d3-dsv 3.0.2 and papaparse 5.7.1); see `LICENSE` and `NOTICE`.
