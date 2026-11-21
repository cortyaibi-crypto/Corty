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
- The reader is a small WASM module (`csv4.wat`, built with wabt, carried in `fast.mjs` as base64) and
  it **streams**: `cases.json` is read in windows (768 KiB) through the module's own memory, and each
  case's answer is written out of fixed regions of that memory as soon as the case ends, in one
  `writev` a case. No 11 MB input buffer and no 12 MB answer buffer is ever faulted in, and no answer
  byte is copied twice.
- The module is resumable: it stops wherever a window ends and continues where it left off, so a text
  may straddle any number of windows.
- Its inner loop masks **64 bytes at a time**: four `v128` loads, one test for each of comma, backslash
  and the raw quote that ends the literal, shifted together into one 64-bit word. That word is then
  consumed event by event — one `ctz`, one 16-byte copy at the event, one 3-byte separator — so the
  old loop's load, compare, bitmask and `ctz` on **every** block becomes one `ctz` on a word that is
  already there.
- The mask follows the reading mode: inside a quoted field only a backslash (and the literal's raw
  quote) is an event, and outside quotes the comma dominates by far. Two loops rather than one, so
  neither dispatch chain has a branch whose direction is close to even. A healthy field's separators,
  a quoted field's opening, its closing quote, a doubled quote, CRLF, LF and a stray CR are each
  handled where they occur; a record's end and the next record's start are written in place.
- p, w, the field's length, the mode, the quote state, the field count, the width and the
  unterminated-quote checkpoint live in **locals** and reach the module's globals only when the loop
  leaves (a refill, the last bytes, a case's end), so the hot path touches no global.
- Everything a case needs — the first record's fields, the rows after it, the errors — is written into
  its own region, so the answer's text is assembled at write time: the first record is `columns` or the
  first row, which only the header flag at the case's end decides.
- Before the file is read, the reader runs once over a small text of its own (about 30 KiB of plain,
  quoted and multi-line fields) so V8's optimizing compiler has the loop before the real work; the
  answers that pass writes are thrown away.
- If `cases.json` is not the shape the reader expects (spaced JSON is fine; anything stranger, or a
  quoted field longer than 64 KiB), `main.ts` falls back to `JSON.parse` plus `run()` from `solve.js` —
  the same answers, slower.

`solve.js` stays the readable drop-in: `run(input)` on a decoded `{text, header}` returns the
reference's answer for every input, and it is what the fallback path uses.

## Verification

- The official local grade (`cli/makefun.mjs grade-local --driver process`) passes every case: 6 of 6
  identical, both executions byte for byte, and the L1 regrade reproduces the result.
- Every text over `, a " \r \n` up to five characters long (both header flags, 7,812 cases), read both
  through the fast loop (padded so the loop, not the tail, reads the interesting text) and through the
  tail: identical to `csv-reader 1.0.0` on every one.
- 4,000 random texts of 60 to 200 characters over `, a " \r \n` and non-ASCII UTF-8: identical.
- Freshly drawn instances from the kit's own generator (3 seeds, 18 cases) and the practice set:
  identical to the reference, and the practice set's answer bytes are the ones the previous build wrote.
- A quote opens a field only as the field's **first byte**: a stray CR dropped at a field's start is
  read the way the reference reads it, and the quote after it is a literal character (an earlier build
  opened a quoted field there; the reference does not).
- The same answers through 768 KiB, 64 KiB and 4 KiB windows as through one whole window.

## Licence

MIT. `solve.js` and the reference it must equal belong to make.fun (`csv-reader 1.0.0`, derived from
d3-dsv 3.0.2 and papaparse 5.7.1); see `LICENSE` and `NOTICE`.
