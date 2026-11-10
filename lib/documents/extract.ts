import * as XLSX from 'xlsx';

/**
 * Pure document text extractor.
 *
 * No database access and no I/O beyond the bytes handed in: the worker owns
 * persistence, this module owns the "what text is inside these bytes" decision.
 * Every branch is total — a failed extraction is still one page with a machine
 * readable `status`, so the caller can always record a page row.
 */
export type ExtractedPage = {
  pageNumber: number;
  ocrText: string | null;
  widthPoints: number | null;
  heightPoints: number | null;
};

export type ExtractResult = {
  pages: ExtractedPage[];
  status: 'completed' | 'partial' | 'failed';
  note?: string;
};

export type DocumentType = 'text' | 'spreadsheet' | 'image' | 'pdf' | 'unsupported';

/** Approximate page size (characters) used when paginating plain text. */
const TEXT_PAGE_CHARS = 3000;

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.ms-excel.sheet.macroenabled.12',
]);

const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls', 'xlsm', 'xltx']);

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
]);

const TEXT_EXTENSIONS = new Set(['csv', 'json', 'md', 'markdown', 'txt', 'xml', 'yaml', 'yml']);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg']);

function normalizeMimeType(mimeType: string | null): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).trim().toLowerCase() : '';
}

/**
 * Classify an upload into the extractor branch it belongs to. MIME type wins,
 * falling back to the file extension so uploads sent as
 * `application/octet-stream` still resolve correctly.
 */
export function classifyDocumentType(input: {
  mimeType: string | null;
  fileName: string;
}): DocumentType {
  const mime = normalizeMimeType(input.mimeType);
  const ext = fileExtension(input.fileName);

  if (SPREADSHEET_MIME_TYPES.has(mime) || SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (mime.startsWith('text/') || TEXT_MIME_TYPES.has(mime) || TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'unsupported';
}

function toBytes(buffer: Buffer | Uint8Array): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : Uint8Array.from(buffer);
}

/**
 * Split decoded text into fixed-size pages. An empty document still yields one
 * page (never zero, never two empty pages) so `page_count` is always >= 1.
 */
export function paginateText(text: string, pageChars = TEXT_PAGE_CHARS): string[] {
  if (text.length === 0) return [''];
  const pages: string[] = [];
  for (let offset = 0; offset < text.length; offset += pageChars) {
    pages.push(text.slice(offset, offset + pageChars));
  }
  return pages;
}

function extractText(bytes: Uint8Array): ExtractResult {
  let text: string;
  let hadInvalidBytes = false;

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
    hadInvalidBytes = true;
  }

  const containsReplacement = text.includes('\uFFFD');
  const status = hadInvalidBytes || containsReplacement ? 'partial' : 'completed';

  return {
    pages: paginateText(text).map((chunk, index) => ({
      pageNumber: index + 1,
      ocrText: chunk,
      widthPoints: null,
      heightPoints: null,
    })),
    status,
    ...(status === 'partial' ? { note: 'text decoding produced replacement characters' } : {}),
  };
}

function extractSpreadsheet(bytes: Uint8Array): ExtractResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'buffer' });
  } catch {
    return {
      pages: [{ pageNumber: 1, ocrText: null, widthPoints: null, heightPoints: null }],
      status: 'failed',
      note: 'spreadsheet could not be parsed',
    };
  }

  const pages: ExtractedPage[] = workbook.SheetNames.map((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet) : '';
    return {
      pageNumber: index + 1,
      ocrText: csv,
      widthPoints: null,
      heightPoints: null,
    };
  });

  if (pages.length === 0) {
    pages.push({ pageNumber: 1, ocrText: null, widthPoints: null, heightPoints: null });
  }

  return { pages, status: 'completed' };
}

/**
 * Extract per-page text from an uploaded document.
 *
 * Images and PDFs are marked `partial` with a truthful note rather than
 * pretending offline OCR/text extraction happened; unsupported types are
 * `failed`. Both still produce a single page so the UI can render a row.
 */
export function extractDocumentText(input: {
  buffer: Buffer | Uint8Array;
  mimeType: string | null;
  fileName: string;
}): ExtractResult {
  const bytes = toBytes(input.buffer);
  const type = classifyDocumentType({ mimeType: input.mimeType, fileName: input.fileName });

  switch (type) {
    case 'text':
      return extractText(bytes);
    case 'spreadsheet':
      return extractSpreadsheet(bytes);
    case 'image':
      return {
        pages: [{ pageNumber: 1, ocrText: null, widthPoints: null, heightPoints: null }],
        status: 'partial',
        note: 'image OCR engine not available offline',
      };
    case 'pdf':
      return {
        pages: [{ pageNumber: 1, ocrText: null, widthPoints: null, heightPoints: null }],
        status: 'partial',
        note: 'pdf text extraction not available offline',
      };
    case 'unsupported':
    default:
      return {
        pages: [{ pageNumber: 1, ocrText: null, widthPoints: null, heightPoints: null }],
        status: 'failed',
        note: `unsupported document type: ${normalizeMimeType(input.mimeType) || fileExtension(input.fileName) || 'unknown'}`,
      };
  }
}
