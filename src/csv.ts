/** Encodes one CSV row, including source paths with commas or quotes. */
export function encodeCsvRow(values: readonly string[]): string {
  return values.map(encodeCsvValue).join(',');
}

function encodeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  // A literal quote is represented by two quotes inside a quoted CSV value.
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Parses the small CSV documents exchanged with tsDetect. Keeping this parser
 * local avoids another runtime dependency while supporting quoted values,
 * embedded commas, escaped quotes, and both LF and CRLF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (insideQuotes) {
      // Two consecutive quotes inside a quoted value decode to one quote.
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        insideQuotes = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      insideQuotes = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (character !== '\r') {
      // Ignore the carriage-return half of a CRLF record separator.
      value += character;
    }
  }

  if (insideQuotes) {
    throw new Error('tsDetect returned malformed CSV with an unterminated value.');
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}
