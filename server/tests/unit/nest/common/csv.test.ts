import { CSV_BOM, csvCell, csvRow, toCsv } from '../../../../src/nest/common/csv';

import { describe, expect, it } from 'vitest';

// Two rules here decide whether a downloaded file opens as the data it claims:
// the quoting, and the formula guard. Everything else is line endings.
describe('csvCell', () => {
  it('leaves a plain value unquoted', () => {
    expect(csvCell('Kyoto')).toBe('Kyoto');
    expect(csvCell(35.0116)).toBe('35.0116');
    expect(csvCell(true)).toBe('true');
  });

  it('writes null and undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes only what needs quoting, and doubles the quotes inside', () => {
    expect(csvCell('Kyoto, Japan')).toBe('"Kyoto, Japan"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('Café 沖縄')).toBe('Café 沖縄');
  });

  // A cell starting with = is code to a spreadsheet, and place names are user
  // input: whoever opens the export next would run whoever typed it's formula.
  it('neutralises a cell that would read as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@sum(A1)')).toBe("'@sum(A1)");
    expect(csvCell('\t=1')).toBe("'\t=1");
  });

  // The guard has to miss real numbers, or every negative coordinate in the file
  // arrives with an apostrophe in front of it. A leading + or - on a figure that
  // parses is not a formula, it is that number.
  it('leaves a negative, signed or exponent number alone', () => {
    expect(csvCell(-135.0)).toBe('-135');
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('+1.5')).toBe('+1.5');
    expect(csvCell('1e5')).toBe('1e5');
    // A phone number is not a number: it has spaces, so it stays text and guarded.
    expect(csvCell('+81 75 123 4567')).toBe("'+81 75 123 4567");
  });
});

describe('csvRow', () => {
  it('joins escaped cells with commas', () => {
    expect(csvRow(['a', 'b, c', null, 3])).toBe('a,"b, c",,3');
  });
});

describe('toCsv', () => {
  it('starts with a BOM and ends every line with CRLF', () => {
    const out = toCsv(
      ['a', 'b'],
      [
        ['1', '2'],
        ['3', '4'],
      ],
    );
    expect(out).toBe(`${CSV_BOM}a,b\r\n1,2\r\n3,4\r\n`);
  });

  it('can drop the BOM for a caller that adds it once to two tables', () => {
    expect(toCsv(['a'], [['1']], { bom: false })).toBe('a\r\n1\r\n');
  });

  it('keeps a header-only table a valid file', () => {
    expect(toCsv(['a', 'b'], [], { bom: false })).toBe('a,b\r\n');
  });
});
