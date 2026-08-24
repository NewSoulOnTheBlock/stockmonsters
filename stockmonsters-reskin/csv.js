/**
 * RFC 4180 CSV parse/serialize, matching what Ruby's CSV.read accepts.
 *
 * PSDK reads these files with `CSV.read` (3_Studio.rb:315), so round-tripping
 * has to preserve embedded commas, quotes and newlines exactly.
 */

export function parse(text) {
  // Strip a UTF-8 BOM; Ruby's CSV would otherwise fold it into the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
      fieldWasQuoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      endRow();
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // A trailing newline ends the last row; anything else is a final field.
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

const needsQuote = (value) => /[",\r\n]/.test(value);

export function serialize(rows, eol = '\n') {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const v = cell == null ? '' : String(cell);
          return needsQuote(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    )
    .join(eol) + eol;
}
