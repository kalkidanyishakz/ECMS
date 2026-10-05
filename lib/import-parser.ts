import { createHash } from 'crypto';
import * as XLSX from 'xlsx';

export type CellValue = string | number | boolean | null;
export type ParsedRow = { rowNumber: number; data: Record<string, CellValue> };
export type ParsedSheet = {
  name: string;
  ordinal: number;
  isHidden: boolean;
  headers: string[];
  rows: ParsedRow[];
  metadata: { delimiter?: string };
};
export type ParsedWorkbook = {
  parserVersion: string;
  sheets: ParsedSheet[];
};

const CSV_PARSER_VERSION = 'csv@1';
const XLSX_PARSER_VERSION = `xlsx@${(XLSX as { version?: string }).version ?? '0.18'}`;

export function rowHash(data: Record<string, CellValue>): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function isCsvFile(name: string): boolean {
  return /\.(csv|txt)$/i.test(name);
}

export function isSpreadsheetFile(name: string): boolean {
  return /\.(xlsx|xls|xlsm|xlsb)$/i.test(name);
}

/** Coerce arbitrary spreadsheet values into JSON-safe primitives. */
function toCellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return String(value);
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/** RFC-4180-ish delimited text parser supporting quoted fields and embedded newlines. */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    sawAny = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') {
        i++;
      }
      pushRow();
    } else {
      field += ch;
    }
  }
  if (sawAny && (field.length > 0 || row.length > 0)) pushRow();
  return rows;
}

function makeHeaders(width: number, rawHeader: unknown[]): string[] {
  const used = new Map<string, number>();
  const headers: string[] = [];
  for (let i = 0; i < width; i++) {
    const raw = rawHeader[i];
    let name = raw === null || raw === undefined ? '' : String(raw).trim();
    if (!name) name = `Column ${i + 1}`;
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    headers.push(seen === 0 ? name : `${name}_${seen + 1}`);
  }
  return headers;
}

function buildSheet(
  matrix: unknown[][],
  name: string,
  ordinal: number,
  isHidden: boolean,
  meta: { delimiter?: string } = {}
): ParsedSheet {
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);

  let headerIndex = -1;
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i].some((cell) => toCellValue(cell) !== null && String(cell).trim() !== '')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return { name, ordinal, isHidden, headers: [], rows: [], metadata: meta };
  }

  const headers = makeHeaders(width, matrix[headerIndex]);
  const rows: ParsedRow[] = [];

  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const raw = matrix[i];
    const data: Record<string, CellValue> = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const value = toCellValue(raw[c]);
      data[headers[c]] = value;
      if (value !== null && String(value).trim() !== '') hasValue = true;
    }
    if (!hasValue) continue;
    rows.push({ rowNumber: i + 1, data });
  }

  return {
    name,
    ordinal,
    isHidden,
    headers,
    rows,
    metadata: meta,
  };
}

function parseCsv(buffer: Buffer, filename: string): ParsedWorkbook {
  const text = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const matrix = parseDelimited(text, delimiter);
  const sheetName = filename.replace(/\.[^.]+$/, '') || 'CSV';
  const sheet = buildSheet(matrix, sheetName, 1, false, { delimiter });
  return { parserVersion: CSV_PARSER_VERSION, sheets: [sheet] };
}

function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
  const hiddenFlags = new Map<string, boolean>();
  for (const meta of workbook.Workbook?.Sheets ?? []) {
    if (!meta.name) continue;
    hiddenFlags.set(meta.name, meta.Hidden === 1 || meta.Hidden === 2);
  }

  const sheets: ParsedSheet[] = workbook.SheetNames.map((name, ordinal) => {
    const worksheet = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      blankrows: true,
      defval: null,
      raw: true,
    });
    return buildSheet(matrix, name, ordinal + 1, hiddenFlags.get(name) ?? false);
  });

  return { parserVersion: XLSX_PARSER_VERSION, sheets };
}

/**
 * Parse a stored CSV or spreadsheet upload into normalized sheets/rows.
 *
 * Row data is keyed by the sheet's header row and the original 1-based sheet
 * row number is preserved so staged rows remain traceable to the source file.
 */
export function parseImportBuffer(buffer: Buffer, filename: string): ParsedWorkbook {
  if (isCsvFile(filename)) return parseCsv(buffer, filename);
  if (isSpreadsheetFile(filename)) return parseWorkbook(buffer);
  throw new Error(`Unsupported file type: ${filename}. Upload a CSV or XLSX file.`);
}
