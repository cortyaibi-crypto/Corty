// Byte-level csv-reader 1.0.0 (v3).
//
// A case's text arrives JSON-escaped inside cases.json, which is already the form a JSON answer wants: a field's
// bytes are copied as they stand and only the CSV layer's own rewrites touch them (a doubled quote to one, a CR
// inside quotes to LF, a stray CR dropped, a line break ending the field). Nothing is decoded to UTF-16, no
// JSON.parse, no JSON.stringify. Within a text literal no raw quote byte can appear (every quote is \" there), so the
// literal's end is a raw quote and needs no scan of its own.
//
// The answer is written as {"rows":…,"errors":…,"columns":…}: the scorer compares values, key order is free, and
// columns (the header record) is certain only once it has been read.
//
// The reader is split into small functions on purpose: this runs once, so what V8 pays to compile a function is part
// of the run, and a small function is compiled in a millisecond or two where one large function costs tens.

const COMMA = 44;
const QUOTE = 34;
const BS = 92;
const LBRACK = 91;
const RBRACK = 93;
const RBRACE = 125;

const END_COMMA = 1;
const END_BREAK = 2;
const END_END = 3;

const E_STRAY = 0;
const E_JUNK = 1;
const E_UNTERM = 2;
const E_SHORT = 3;
const E_LONG = 4;

const TEXT_KEY_B = Buffer.from('"text":"', 'latin1');
const HDR_KEY_B = Buffer.from('","header":', 'latin1');

function put(dst, w, s) {
  for (let i = 0; i < s.length; i++) dst[w + i] = s.charCodeAt(i);
  return w + s.length;
}

function putInt(dst, w, n) {
  if (n < 10) {
    dst[w++] = 48 + n;
    return w;
  }
  const digits = [];
  while (n > 0) {
    digits.push(48 + (n % 10));
    n = (n / 10) | 0;
  }
  for (let i = digits.length - 1; i >= 0; i--) dst[w++] = digits[i];
  return w;
}

function growTo(dst, w, need) {
  const bigger = Buffer.allocUnsafe(Math.max(dst.length * 2, w + need + 65536));
  bigger.set(dst.subarray(0, w));
  return bigger;
}

// ---- the quoted field, a function of its own (rb* are its results)
let rbP = 0;
let rbW = 0;
let rbLine = 1;
let rbEnded = END_END;

/** The bytes after a closing quote, or after an unterminated one: the unquoted reader over the rest of the field. */
let rcP = 0;
let rcW = 0;
let rcLine = 1;
let rcAdded = 0;

function readRest(src, E, dst, errors, recordLine, recordRow) {
  // The rare path (junk after a closing quote, or after an unterminated one): byte by byte, as the reference reads it.
  let p = rcP;
  let w = rcW;
  let line = rcLine;
  let added = 0;
  for (;;) {
    if (p >= E) {
      rcP = p;
      rcW = w;
      rcLine = line;
      rcAdded = added;
      return END_END;
    }
    const c = src[p];
    if (c !== COMMA && c !== BS) {
      dst[w++] = c;
      p++;
      added++;
      continue;
    }
    if (c === COMMA) {
      rcP = p + 1;
      rcW = w;
      rcLine = line;
      rcAdded = added;
      return END_COMMA;
    }
    const e = src[p + 1];
    if (e === 110) {
      rcP = p + 2;
      rcW = w;
      rcLine = line + 1;
      rcAdded = added;
      return END_BREAK;
    }
    if (e === 114) {
      if (p + 3 < E && src[p + 2] === BS && src[p + 3] === 110) {
        rcP = p + 4;
        rcW = w;
        rcLine = line + 1;
        rcAdded = added;
        return END_BREAK;
      }
      errors.push({ c: E_STRAY, line: recordLine, row: recordRow });
      p += 2;
      continue;
    }
    dst[w++] = BS;
    dst[w++] = e;
    p += 2;
    added++;
  }
}

/**
 * A quoted field whose opening quote is at `p` (the backslash of \"): the field's bytes into dst at w, its end in
 * rb* (rbP after the field, rbW after its bytes, rbLine the line, rbEnded how it ended).
 */
function readQuoted(src, E, dst, w, p, line, recordLine, recordRow, errors) {
  const openP = p;
  const openLine = line;
  p += 2;
  const qStart = w;
  dst[w++] = QUOTE;
  let closed = false;
  let nb = -1;
  for (;;) {
    if (nb < p) {
      nb = src.indexOf(BS, p);
      if (nb < 0 || nb > E) nb = E;
    }
    if (nb >= E) {
      src.copy(dst, w, p, E);
      w += E - p;
      p = E;
      break;
    }
    if (nb > p) {
      src.copy(dst, w, p, nb);
      w += nb - p;
      p = nb;
    }
    const e = src[p + 1];
    if (e === QUOTE) {
      if (p + 3 < E && src[p + 2] === BS && src[p + 3] === QUOTE) {
        dst[w++] = BS;
        dst[w++] = QUOTE;
        p += 4;
        nb = -1;
        continue;
      }
      p += 2;
      closed = true;
      break;
    }
    if (e === 110) {
      dst[w++] = BS;
      dst[w++] = 110;
      p += 2;
      line++;
      nb = -1;
      continue;
    }
    if (e === 114) {
      dst[w++] = BS;
      dst[w++] = 110;
      line++;
      p += p + 3 < E && src[p + 2] === BS && src[p + 3] === 110 ? 4 : 2;
      nb = -1;
      continue;
    }
    dst[w++] = BS;
    dst[w++] = e;
    p += 2;
    nb = -1;
  }
  if (!closed) {
    // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
    w = qStart;
    dst[w++] = QUOTE;
    dst[w++] = BS;
    dst[w++] = QUOTE;
    errors.push({ c: E_UNTERM, line: recordLine, row: recordRow });
    rcP = openP + 2;
    rcW = w;
    rcLine = openLine;
    rbEnded = readRest(src, E, dst, errors, recordLine, recordRow);
    rbP = rcP;
    rbW = rcW;
    rbLine = rcLine;
    dst[rbW++] = QUOTE;
    return;
  }
  if (p >= E) {
    rbP = p;
    rbW = w;
    rbLine = line;
    rbEnded = END_END;
    dst[rbW++] = QUOTE;
    return;
  }
  const c = src[p];
  if (c === COMMA) {
    rbP = p + 1;
    rbW = w;
    rbLine = line;
    rbEnded = END_COMMA;
  } else if (c === BS && src[p + 1] === 110) {
    rbP = p + 2;
    rbW = w;
    rbLine = line + 1;
    rbEnded = END_BREAK;
  } else if (c === BS && src[p + 1] === 114 && p + 3 < E && src[p + 2] === BS && src[p + 3] === 110) {
    rbP = p + 4;
    rbW = w;
    rbLine = line + 1;
    rbEnded = END_BREAK;
  } else {
    // What follows the closing quote is appended to the field as it stands (quote_junk when it kept any).
    rcP = p;
    rcW = w;
    rcLine = line;
    rbEnded = readRest(src, E, dst, errors, recordLine, recordRow);
    rbP = rcP;
    rbW = rcW;
    rbLine = rcLine;
    if (rcAdded > 0) errors.push({ c: E_JUNK, line: recordLine, row: recordRow });
  }
  dst[rbW++] = QUOTE;
}

/** The errors and columns of a case, once its rows are written; the answer closes here. */
function writeTail(dst, w, errors, header, columnsSeen, colBuf, colLen, st) {
  if (w + errors.length * 80 + colLen + 4096 > dst.length) {
    dst = growTo(dst, w, errors.length * 80 + colLen + 4096);
    st.buf = dst;
  }
  w = put(dst, w, '],"errors":[');
  for (let i = 0; i < errors.length; i++) {
    if (i > 0) dst[w++] = COMMA;
    const err = errors[i];
    w = put(dst, w, '{"code":"');
    w = put(dst, w, err.c === E_STRAY ? 'stray_cr' : err.c === E_JUNK ? 'quote_junk' : err.c === E_UNTERM ? 'unterminated_quote' : err.c === E_SHORT ? 'short_row' : 'long_row');
    w = put(dst, w, '","line":');
    w = putInt(dst, w, err.line);
    w = put(dst, w, ',"row":');
    w = err.row < 0 ? put(dst, w, 'null') : putInt(dst, w, err.row);
    if (err.c === E_SHORT) {
      w = put(dst, w, ',"fields":');
      w = putInt(dst, w, err.fields);
    } else if (err.c === E_LONG) {
      w = put(dst, w, ',"extra":[');
      dst.set(err.extra, w);
      w += err.extra.length;
      w = put(dst, w, ']');
    }
    dst[w++] = RBRACE;
  }
  w = put(dst, w, '],"columns":');
  if (!header) {
    w = put(dst, w, 'null');
  } else if (!columnsSeen) {
    w = put(dst, w, '[]');
  } else {
    dst[w++] = LBRACK;
    dst.set(colBuf.subarray(0, colLen), w);
    w += colLen;
    dst[w++] = RBRACK;
  }
  dst[w++] = RBRACE;
  return w;
}

/**
 * One case's answer into `buf` at `w0`: A the first byte of its text literal, E the first after it (a raw quote).
 * Returns the new w; the buffer it grew to is st.buf.
 */
function convertCase(src, A, E, header, buf, w0, st) {
  let dst = buf;
  let p = A;
  let w = w0;
  let line = 1;
  let width = -1;
  let recordLine = 1;
  let recordRow = 0;
  let rowCount = 0;
  let columnsSeen = false;
  let nb = -1; // the next backslash at or after p, E when there is none before the literal's end

  const errors = st.errors;
  errors.length = 0;
  let colLen = 0;

  w = put(dst, w, '{"rows":[');

  // A U+FEFF at the very start of the text is dropped (raw UTF-8, or escaped).
  if (p < E) {
    if (src[p] === 0xef && src[p + 1] === 0xbb && src[p + 2] === 0xbf) p += 3;
    else if (src[p] === BS && src[p + 1] === 117 && src[p + 2] === 102 && src[p + 3] === 101 && src[p + 4] === 102 && src[p + 5] === 102) p += 6;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (p < E) {
      if (src[p] === BS) {
        const e = src[p + 1];
        if (e === 110) {
          p += 2;
          line++;
          continue;
        }
        if (e === 114 && p + 3 < E && src[p + 2] === BS && src[p + 3] === 110) {
          p += 4;
          line++;
          continue;
        }
      }
      break;
    }
    if (p >= E) break;

    recordLine = line;
    recordRow = header && !columnsSeen ? -1 : rowCount;

    const recStart = w;
    if (rowCount > 0) dst[w++] = COMMA;
    dst[w++] = LBRACK;
    let n = 0;
    let ended = END_END;
    let quoted = false;
    let fs1 = w;
    let mark = 0;

    for (;;) {
      const fs = w;
      if (n === 0) fs1 = fs;
      else if (n === width) mark = fs;
      if (src[p] === BS && src[p + 1] === QUOTE) {
        quoted = true;
        readQuoted(src, E, dst, w, p, line, recordLine, recordRow, errors);
        w = rbW;
        p = rbP;
        line = rbLine;
        ended = rbEnded;
        nb = -1;
      } else {
        quoted = false;
        dst[w++] = QUOTE;
        for (;;) {
          if (nb < p) {
            nb = src.indexOf(BS, p);
            if (nb < 0 || nb > E) nb = E;
          }
          let q = src.indexOf(COMMA, p);
          if (q < 0 || q > E) q = E + 1; // no comma left in this field
          if (q < nb) {
            src.copy(dst, w, p, q);
            w += q - p;
            p = q + 1;
            ended = END_COMMA;
            break;
          }
          if (nb >= E) {
            src.copy(dst, w, p, E);
            w += E - p;
            p = E;
            ended = END_END;
            break;
          }
          if (nb > p) {
            src.copy(dst, w, p, nb);
            w += nb - p;
            p = nb;
          }
          const e = src[p + 1];
          if (e === 110) {
            p += 2;
            line++;
            ended = END_BREAK;
            break;
          }
          if (e === 114) {
            if (p + 3 < E && src[p + 2] === BS && src[p + 3] === 110) {
              p += 4;
              line++;
              ended = END_BREAK;
              break;
            }
            errors.push({ c: E_STRAY, line: recordLine, row: recordRow });
            p += 2;
            nb = -1;
            continue;
          }
          dst[w++] = BS;
          dst[w++] = e;
          p += 2;
          nb = -1;
        }
        dst[w++] = QUOTE;
      }
      n++;
      if (ended !== END_COMMA) break;
      dst[w++] = COMMA;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (n === 1 && !quoted && w - fs1 === 2) {
      w = recStart;
      continue;
    }

    if (width < 0) width = n;
    if (header && !columnsSeen) {
      columnsSeen = true;
      colLen = w - fs1;
      if (st.colBuf.length < colLen) st.colBuf = new Uint8Array(colLen * 2);
      st.colBuf.set(dst.subarray(fs1, fs1 + colLen), 0);
      w = recStart;
      continue;
    }
    if (n < width) {
      errors.push({ c: E_SHORT, line: recordLine, row: recordRow, fields: n });
      for (let i = n; i < width; i++) {
        dst[w++] = COMMA;
        dst[w++] = QUOTE;
        dst[w++] = QUOTE;
      }
    } else if (n > width) {
      // The fields past the width are one run of JSON strings: cut them out, keep them for the error.
      const extra = Buffer.from(dst.subarray(mark, w));
      errors.push({ c: E_LONG, line: recordLine, row: recordRow, extra });
      w = mark - 1;
    }
    dst[w++] = RBRACK;
    rowCount++;
    // Room for the next record's worst case (two output bytes a text byte), so nothing inside it needs a check.
    const need = (E - p) * 2 + 4096;
    if (w + need > dst.length) {
      dst = growTo(dst, w, need);
      st.buf = dst;
    }
  }

  return writeTail(dst, w, errors, header, columnsSeen, st.colBuf, colLen, st);
}

/** The answers for every case of cases.json's bytes, as a Buffer. */
export function answersBytes(src) {
  let dst = Buffer.allocUnsafe(Math.ceil(src.length * 2.2) + 4096);
  const st = {
    buf: dst,
    errors: [],
    colBuf: new Uint8Array(8192),
  };
  let w = 0;
  dst[w++] = LBRACK;
  let search = 0;
  let n = 0;
  for (;;) {
    const at = src.indexOf(TEXT_KEY_B, search);
    if (at < 0) break;
    const A = at + TEXT_KEY_B.length;
    const hdr = src.indexOf(HDR_KEY_B, A);
    if (hdr < 0) throw new Error('cases.json: no header key after a text');
    const header = src[hdr + HDR_KEY_B.length] === 116; // 't'
    if (n > 0) dst[w++] = COMMA;
    w = convertCase(src, A, hdr, header, dst, w, st);
    dst = st.buf;
    n++;
    search = hdr + HDR_KEY_B.length;
  }
  dst[w++] = RBRACK;
  return dst.subarray(0, w);
}
