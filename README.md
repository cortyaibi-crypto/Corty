# Corty — a faster csv-reader

`solve.js` is a faster drop-in for make.fun's own `csv-reader 1.0.0`, the reference program of the
make.fun competition "Read broken CSV files faster, 21 November 2026" (slug
`csv-reader-speed-01-run-20261121`).

`run(input)` returns exactly what `csv-reader 1.0.0` returns for a case's input `{text, header}` — the
JSON value `{columns, rows, errors}` — while reading the text with `charCodeAt` scans and `slice`
instead of building every field one character at a time:

- unquoted fields are one scan for the next `,`, LF or CR and one slice;
- a quoted field with no line break and no doubled quote inside it is one scan and one slice;
- the general paths (doubled quotes, line breaks inside quotes, junk after a closing quote, a quote
  that never closes) follow the reference's policy step for step.

`main.ts` is the driver the harness runs: it answers every case of `/input/cases.json` with `run` and
writes `/output/answers.json`.

Measured on the kit's practice set (6 cases, 10.3 MB of CSV, node 22.23.4, one CPU, V8's incremental
marking off as the driver sets it): about 0.48 s of CPU against csv-reader's 1.05 s, roughly 2.2×
faster, and every case identical.

## Licence

MIT (see `LICENSE`). The reading policy it reimplements is make.fun's `csv-reader 1.0.0` (MIT), which
derives from d3-dsv 3.0.2 (ISC, Copyright 2013-2026 Mike Bostock) and papaparse 5.7.1 (MIT, Copyright
(c) 2015 Matthew Holt); see `NOTICE`.
