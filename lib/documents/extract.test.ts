import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { classifyDocumentType, extractDocumentText, paginateText } from './extract';

describe('paginateText', () => {
  it('splits long text into sequential ~3000-char pages', () => {
    const text = 'a'.repeat(6500);

    const pages = paginateText(text);

    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.length)).toEqual([3000, 3000, 500]);
  });

  it('returns exactly one page for empty input (never zero, never two empty)', () => {
    expect(paginateText('')).toEqual(['']);
  });

  it('keeps short text as a single page', () => {
    expect(paginateText('hello world')).toEqual(['hello world']);
  });
});

describe('classifyDocumentType', () => {
  it('prefers the MIME type when it is known', () => {
    expect(classifyDocumentType({ mimeType: 'application/pdf', fileName: 'scan.txt' })).toBe('pdf');
  });

  it('falls back to the file extension when the MIME type is generic', () => {
    expect(classifyDocumentType({ mimeType: 'application/octet-stream', fileName: 'data.JSON' })).toBe(
      'text'
    );
    expect(classifyDocumentType({ mimeType: null, fileName: 'book.xlsx' })).toBe('spreadsheet');
  });
});

describe('extractDocumentText — text-like files', () => {
  it('decodes and pages a text file, marking it completed', () => {
    const buffer = Buffer.from('b'.repeat(6500), 'utf8');

    const result = extractDocumentText({ buffer, mimeType: 'text/plain', fileName: 'notes.txt' });

    expect(result.status).toBe('completed');
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(result.pages[0].ocrText).toHaveLength(3000);
    expect(result.pages[2].ocrText).toHaveLength(500);
    expect(result.pages[0].widthPoints).toBeNull();
  });

  it('treats CSV as text and JSON by extension', () => {
    const csv = extractDocumentText({
      buffer: Buffer.from('a,b\n1,2\n'),
      mimeType: 'text/csv',
      fileName: 'sheet.csv',
    });
    expect(csv.status).toBe('completed');
    expect(csv.pages).toHaveLength(1);
    expect(csv.pages[0].ocrText).toContain('a,b');

    const json = extractDocumentText({
      buffer: Buffer.from('{"ok":true}'),
      mimeType: 'application/octet-stream',
      fileName: 'payload.json',
    });
    expect(json.status).toBe('completed');
    expect(json.pages[0].ocrText).toBe('{"ok":true}');
  });

  it('returns one empty page for an empty text file', () => {
    const result = extractDocumentText({
      buffer: Buffer.from(''),
      mimeType: 'text/plain',
      fileName: 'empty.txt',
    });

    expect(result.status).toBe('completed');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].ocrText).toBe('');
  });

  it('marks text with invalid UTF-8 bytes as partial', () => {
    const result = extractDocumentText({
      buffer: Buffer.from([0x41, 0xff, 0x42]),
      mimeType: 'text/plain',
      fileName: 'broken.txt',
    });

    expect(result.status).toBe('partial');
    expect(result.note).toBeTruthy();
    expect(result.pages).toHaveLength(1);
  });
});

describe('extractDocumentText — spreadsheets', () => {
  it('reads one page per sheet as CSV and marks it completed', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Item', 'Qty'],
        ['A', 1],
      ]),
      'Items'
    );
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['X'], [9]]), 'Extra');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const result = extractDocumentText({
      buffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'boq.xlsx',
    });

    expect(result.status).toBe('completed');
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(result.pages[0].ocrText).toContain('Item');
    expect(result.pages[1].ocrText).toContain('X');
  });
});

describe('extractDocumentText — images and PDFs', () => {
  it('marks an image partial with no text and a truthful note', () => {
    const result = extractDocumentText({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
      fileName: 'photo.png',
    });

    expect(result.status).toBe('partial');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].ocrText).toBeNull();
    expect(result.note).toBe('image OCR engine not available offline');
  });

  it('marks a PDF partial with no text and a truthful note', () => {
    const result = extractDocumentText({
      buffer: Buffer.from('%PDF-1.7'),
      mimeType: 'application/pdf',
      fileName: 'drawing.pdf',
    });

    expect(result.status).toBe('partial');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].ocrText).toBeNull();
    expect(result.note).toBe('pdf text extraction not available offline');
  });
});

describe('extractDocumentText — unsupported types', () => {
  it('marks unknown binary types failed with one empty page', () => {
    const result = extractDocumentText({
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      mimeType: 'application/zip',
      fileName: 'archive.zip',
    });

    expect(result.status).toBe('failed');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].ocrText).toBeNull();
    expect(result.note).toContain('unsupported document type');
  });
});
