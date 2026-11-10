import { describe, it, expect } from 'vitest';
import { humanFileSize, validateAttachmentTarget } from './attachments';

describe('humanFileSize', () => {
  it('renders sub-kilobyte sizes as whole bytes', () => {
    expect(humanFileSize(0)).toBe('0 B');
    expect(humanFileSize(1)).toBe('1 B');
    expect(humanFileSize(1023)).toBe('1023 B');
  });

  it('scales into binary units with one decimal place', () => {
    expect(humanFileSize(1024)).toBe('1.0 KB');
    expect(humanFileSize(1536)).toBe('1.5 KB');
    expect(humanFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(humanFileSize(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB');
  });

  it('accepts bigint byte counts', () => {
    expect(humanFileSize(BigInt(1024))).toBe('1.0 KB');
    expect(humanFileSize(BigInt(0))).toBe('0 B');
  });

  it('renders non-finite and negative values as an em dash', () => {
    expect(humanFileSize(Number.NaN)).toBe('—');
    expect(humanFileSize(Number.POSITIVE_INFINITY)).toBe('—');
    expect(humanFileSize(-1)).toBe('—');
  });
});

describe('validateAttachmentTarget', () => {
  const measurementId = 'measurement-1';
  const lineIds = ['line-1', 'line-2'];

  it('defaults to the measurement itself when no target is supplied', () => {
    expect(validateAttachmentTarget({ measurementId, lineIds })).toEqual({
      ok: true,
      recordType: 'measurement',
      recordId: measurementId,
    });
  });

  it('accepts an explicit measurement target matching the measurement id', () => {
    expect(
      validateAttachmentTarget({ recordType: 'measurement', recordId: measurementId, measurementId, lineIds })
    ).toEqual({ ok: true, recordType: 'measurement', recordId: measurementId });
  });

  it('rejects a measurement target pointing at another record', () => {
    const result = validateAttachmentTarget({
      recordType: 'measurement',
      recordId: 'other-measurement',
      measurementId,
      lineIds,
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a measurement_line target belonging to the measurement', () => {
    expect(
      validateAttachmentTarget({
        recordType: 'measurement_line',
        recordId: 'line-2',
        measurementId,
        lineIds,
      })
    ).toEqual({ ok: true, recordType: 'measurement_line', recordId: 'line-2' });
  });

  it('rejects a measurement_line target that is not one of the measurement lines', () => {
    const result = validateAttachmentTarget({
      recordType: 'measurement_line',
      recordId: 'line-999',
      measurementId,
      lineIds,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a measurement_line target with no record_id (defaults to measurement id, not a line)', () => {
    const result = validateAttachmentTarget({ recordType: 'measurement_line', measurementId, lineIds });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported record_type', () => {
    const result = validateAttachmentTarget({
      recordType: 'rfi',
      recordId: measurementId,
      measurementId,
      lineIds,
    });
    expect(result.ok).toBe(false);
  });
});
