import { ApiError } from '@ideanest/api-client';
import { PhotoNotUsable, maskCardNumber, studentRefusalFrom } from './api';

/** The student check's pure helpers (#655): the masked number and the refusal map. */

describe('maskCardNumber', () => {
  it('shows the last four characters only', () => {
    expect(maskCardNumber('AB123456')).toBe('•••• 3456');
    expect(maskCardNumber('ab 12 34 56')).toBe('•••• 3456');
  });

  it('shows none of a number of four or fewer', () => {
    expect(maskCardNumber('123')).toBe('••••');
    expect(maskCardNumber('1234')).toBe('••••');
  });
});

describe('studentRefusalFrom', () => {
  const refused = (status: number, code?: string, field?: string) =>
    new ApiError(status, { status, ...(code === undefined ? {} : { code }), ...(field === undefined ? {} : { field }) } as never);

  it('reads the code, and the file the service named', () => {
    expect(studentRefusalFrom(refused(409, 'STUDENT_CARD_IN_USE'))).toEqual({ refusal: 'cardInUse', field: null });
    expect(studentRefusalFrom(refused(400, 'TOO_LARGE', 'studentCard'))).toEqual({
      refusal: 'tooLarge',
      field: 'studentCard',
    });
    expect(studentRefusalFrom(refused(400, 'EMPTY', 'selfie'))).toEqual({ refusal: 'emptyFile', field: 'selfie' });
  });

  it('ignores a field it does not know', () => {
    expect(studentRefusalFrom(refused(400, 'UNSUPPORTED_TYPE', 'file'))).toEqual({
      refusal: 'unsupportedFile',
      field: null,
    });
  });

  it('reads a photograph the phone could not use, and anything else as generic', () => {
    expect(studentRefusalFrom(new PhotoNotUsable('tooLarge'))).toEqual({ refusal: 'tooLarge', field: null });
    expect(studentRefusalFrom(new TypeError('Network request failed'))).toEqual({ refusal: 'generic', field: null });
    expect(studentRefusalFrom(refused(503))).toEqual({ refusal: 'storageUnavailable', field: null });
  });
});
