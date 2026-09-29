/**
 * The CSV every server-side export writes.
 *
 * There was no writer here before because every CSV in the product was assembled
 * in the browser. Anything the server sends needs these rules in one place, and
 * two of them are not obvious:
 *
 * - CRLF line endings and a UTF-8 BOM. Excel on Windows reads a BOM-less file in
 *   the local codepage, which turns 沖縄 into mojibake, and it wants CR LF.
 * - The formula guard. A cell starting with `=` is not text to a spreadsheet, it
 *   is code it runs. Place names, notes and categories are user input, so an
 *   export without this hands whoever opens the file next a formula injection.
 */

/** A comma, a quote or any line break forces the cell to be quoted. */
const NEEDS_QUOTES = /[",\r\n]/;

/** Characters Excel and Google Sheets read as the start of a formula. */
const FORMULA_START = /^[=+@\t\r-]/;

export type CsvValue = string | number | boolean | null | undefined;

/**
 * Written as an escape rather than the character itself, because the character is
 * invisible: a file that lost it in a reformat would look untouched. Exported for
 * the one caller that composes two tables into a single file and so has to add the
 * BOM once, by hand.
 */
export const CSV_BOM = '\uFEFF';

/** Whether the text is a number, which is the one case `-12.5` must not be quoted as a formula. */
function isNumericText(text: string): boolean {
  return text.trim() !== '' && Number.isFinite(Number(text));
}

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  // The apostrophe is the guard: a spreadsheet drops the leading one when it
  // reads the cell, so what reaches the user is the text they typed.
  const dangerous = FORMULA_START.test(text) && !isNumericText(text);
  const safe = dangerous ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(cells: CsvValue[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * `header` plus `rows`, joined the way a spreadsheet expects. Pass `bom: false`
 * only when the text is compared rather than opened as a file — a test, or a
 * caller that writes its own BOM.
 */
export function toCsv(header: string[], rows: CsvValue[][], options: { bom?: boolean } = {}): string {
  const body = [csvRow(header), ...rows.map(csvRow)].join('\r\n');
  return `${options.bom === false ? '' : CSV_BOM}${body}\r\n`;
}
