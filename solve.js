// A faster drop-in for make.fun's csv-reader 1.0.0: run(input) returns exactly csv-reader's answer for the case's
// input {text, header}, the JSON value {columns, rows, errors}, while reading the text with charCodeAt scans and
// slices instead of one character at a time.
//
// The policy is csv-reader 1.0.0's, unchanged:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and each
//     CRLF or lone CR inside it is read as LF; what follows its closing quote, up to the next comma or line break, is
//     appended to it as it stands (quote_junk, when the field ends); a quote that never closes is read as a literal
//     character and the text after it is read again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record when
//     header is false), each padded with "" (short_row, with fields: its count) or cut (long_row, with extra: the cut
//     fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF and lone CR inside a
//     quoted field counted), row its record's index in rows (null for the header), in the order met.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const COMMA = 44; // ,
const QUOTE = 34; // "
const LF = 10;
const CR = 13;

const ENDED_COMMA = 1;
const ENDED_BREAK = 2;
const ENDED_END = 3;

/** The state a slow path carries between itself and run(): where the scan is and how it ended. */
const st = { pos: 0, line: 1, added: 0, ended: ENDED_END };

/**
 * Reads unquoted characters from st.pos onto `init`, up to the next comma or line break: a CR not followed by LF is
 * dropped (stray_cr). Returns the field's value, and leaves st.pos, st.line, st.ended (and st.added, the characters
 * kept after `init`) updated.
 */
function readUnquotedSlow(text, len, errors, rLine, rRow, init) {
  let pos = st.pos;
  let line = st.line;
  let value = init;
  let kept = pos;
  let added = 0;
  while (pos < len) {
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      value += text.slice(kept, pos);
      added += pos - kept;
      pos += 1;
      st.pos = pos;
      st.line = line;
      st.added = added;
      st.ended = ENDED_COMMA;
      return value;
    }
    if (c === LF) {
      value += text.slice(kept, pos);
      added += pos - kept;
      pos += 1;
      line += 1;
      st.pos = pos;
      st.line = line;
      st.added = added;
      st.ended = ENDED_BREAK;
      return value;
    }
    if (c === CR) {
      if (pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
        value += text.slice(kept, pos);
        added += pos - kept;
        pos += 2;
        line += 1;
        st.pos = pos;
        st.line = line;
        st.added = added;
        st.ended = ENDED_BREAK;
        return value;
      }
      errors.push({ code: 'stray_cr', line: rLine, row: rRow });
      value += text.slice(kept, pos);
      added += pos - kept;
      pos += 1;
      kept = pos;
      continue;
    }
    pos += 1;
  }
  value += text.slice(kept, pos);
  added += pos - kept;
  st.pos = pos;
  st.line = line;
  st.added = added;
  st.ended = ENDED_END;
  return value;
}

/**
 * Reads a quoted field whose opening quote is at st.pos, the general way (doubled quotes, line breaks inside it and
 * an unterminated quote all handled). Returns the field's value and leaves st.pos, st.line, st.ended updated;
 * st.added is set by the junk read when what follows the closing quote is appended.
 */
function readQuotedSlow(text, len, errors, rLine, rRow) {
  const open = st.pos;
  const openLine = st.line;
  let pos = open + 1;
  let line = openLine;
  let parts = null; // null while the value is a single slice from open + 1 to the first break of the scan
  let kept = open + 1;
  let closed = -1;
  while (pos < len) {
    const c = text.charCodeAt(pos);
    if (c === QUOTE) {
      if (pos + 1 < len && text.charCodeAt(pos + 1) === QUOTE) {
        parts = parts === null ? [] : parts;
        parts.push(text.slice(kept, pos), '"');
        pos += 2;
        kept = pos;
        continue;
      }
      closed = pos;
      pos += 1;
      break;
    }
    if (c === CR) {
      parts = parts === null ? [] : parts;
      parts.push(text.slice(kept, pos), '\n');
      line += 1;
      pos += pos + 1 < len && text.charCodeAt(pos + 1) === LF ? 2 : 1;
      kept = pos;
      continue;
    }
    if (c === LF) {
      parts = parts === null ? [] : parts;
      parts.push(text.slice(kept, pos), '\n');
      line += 1;
      pos += 1;
      kept = pos;
      continue;
    }
    pos += 1;
  }
  if (closed < 0) {
    // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
    st.pos = open + 1;
    st.line = openLine;
    errors.push({ code: 'unterminated_quote', line: rLine, row: rRow });
    return readUnquotedSlow(text, len, errors, rLine, rRow, '"');
  }
  let value;
  if (parts === null) value = text.slice(kept === open + 1 ? open + 1 : kept, closed);
  else {
    parts.push(text.slice(kept, closed));
    value = parts.join('');
  }
  if (pos >= len) {
    st.pos = pos;
    st.line = line;
    st.ended = ENDED_END;
    return value;
  }
  const c = text.charCodeAt(pos);
  if (c === COMMA) {
    st.pos = pos + 1;
    st.line = line;
    st.ended = ENDED_COMMA;
    return value;
  }
  if (c === LF) {
    st.pos = pos + 1;
    st.line = line + 1;
    st.ended = ENDED_BREAK;
    return value;
  }
  if (c === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
    st.pos = pos + 2;
    st.line = line + 1;
    st.ended = ENDED_BREAK;
    return value;
  }
  // What follows the closing quote is appended as it stands, up to the next comma or line break.
  st.pos = pos;
  st.line = line;
  const junk = readUnquotedSlow(text, len, errors, rLine, rRow, value);
  if (st.added > 0) errors.push({ code: 'quote_junk', line: rLine, row: rRow });
  return junk;
}

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;
  if (len !== 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let fieldQuoted = false;
    let ended = ENDED_END;
    for (;;) {
      // ---- one field, starting at pos
      if (text.charCodeAt(pos) === QUOTE) {
        fieldQuoted = true;
        const open = pos;
        const openLine = line;
        let p = pos + 1;
        let d = 0;
        while (p < len) {
          d = text.charCodeAt(p);
          if (d === QUOTE || d === CR || d === LF) break;
          p += 1;
        }
        if (p >= len) {
          // No closing quote before the end of the text.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          st.pos = pos;
          st.line = line;
          const value = readUnquotedSlow(text, len, errors, recordLine, recordRow, '"');
          fields.push(value);
          pos = st.pos;
          line = st.line;
          ended = st.ended;
        } else if (d === QUOTE && !(p + 1 < len && text.charCodeAt(p + 1) === QUOTE)) {
          // A closing quote: the common case, a quoted field with nothing else in it.
          const value = text.slice(open + 1, p);
          pos = p + 1;
          if (pos >= len) {
            fields.push(value);
            ended = ENDED_END;
          } else {
            const e = text.charCodeAt(pos);
            if (e === COMMA) {
              fields.push(value);
              pos += 1;
              ended = ENDED_COMMA;
            } else if (e === LF) {
              fields.push(value);
              pos += 1;
              line += 1;
              ended = ENDED_BREAK;
            } else if (e === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
              fields.push(value);
              pos += 2;
              line += 1;
              ended = ENDED_BREAK;
            } else {
              // Junk after the closing quote, or a lone CR: the general path reads it on.
              st.pos = open;
              st.line = openLine;
              const v = readQuotedSlow(text, len, errors, recordLine, recordRow);
              fields.push(v);
              pos = st.pos;
              line = st.line;
              ended = st.ended;
            }
          }
        } else {
          // A doubled quote, or a line break inside the quoted field: the general path.
          st.pos = open;
          st.line = openLine;
          const value = readQuotedSlow(text, len, errors, recordLine, recordRow);
          fields.push(value);
          pos = st.pos;
          line = st.line;
          ended = st.ended;
        }
      } else {
        fieldQuoted = false;
        const start = pos;
        let p = pos;
        let d = 0;
        while (p < len) {
          d = text.charCodeAt(p);
          if (d === COMMA || d === LF || d === CR) break;
          p += 1;
        }
        if (p >= len) {
          fields.push(text.slice(start, p));
          pos = p;
          ended = ENDED_END;
        } else if (d === COMMA) {
          fields.push(text.slice(start, p));
          pos = p + 1;
          ended = ENDED_COMMA;
        } else if (d === LF) {
          fields.push(text.slice(start, p));
          pos = p + 1;
          line += 1;
          ended = ENDED_BREAK;
        } else if (p + 1 < len && text.charCodeAt(p + 1) === LF) {
          fields.push(text.slice(start, p));
          pos = p + 2;
          line += 1;
          ended = ENDED_BREAK;
        } else {
          // A stray CR inside the field: dropped (stray_cr), the field read on.
          const head = text.slice(start, p);
          pos = p;
          st.pos = pos;
          st.line = line;
          fields.push(readUnquotedSlow(text, len, errors, recordLine, recordRow, head));
          pos = st.pos;
          line = st.line;
          ended = st.ended;
        }
      }
      if (ended !== ENDED_COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !fieldQuoted) continue;

    const count = fields.length;
    if (width < 0) width = count;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (count < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: count });
      for (let i = count; i < width; i += 1) fields.push('');
    } else if (count > width) {
      const extra = fields.slice(width);
      fields.length = width;
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}
