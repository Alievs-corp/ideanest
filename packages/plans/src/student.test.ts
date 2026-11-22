import { describe, expect, it } from 'vitest';
import {
  maySubmit,
  qualifiesForStudentPlans,
  readStudentVerification,
  studentSubmissionRefusalOf,
} from './student';

describe('readStudentVerification', () => {
  it('reads a pending submission and treats absent fields as null', () => {
    const read = readStudentVerification({
      state: 'PENDING',
      institution: 'ADA University',
      cardNumber: 'S12345',
      submittedAt: '2026-11-20T10:00:00Z',
    });
    expect(read).toEqual({
      state: 'PENDING',
      institution: 'ADA University',
      cardNumber: 'S12345',
      submittedAt: '2026-11-20T10:00:00Z',
      decidedAt: null,
      validUntil: null,
      rejectionReason: null,
    });
  });

  it('refuses a body without a known state', () => {
    expect(readStudentVerification({ state: 'MAYBE' })).toBeNull();
    expect(readStudentVerification(null)).toBeNull();
    expect(readStudentVerification([])).toBeNull();
  });
});

describe('maySubmit and qualifiesForStudentPlans', () => {
  const of = (state: string) => readStudentVerification({ state });

  it('accepts a submission only when nothing is pending or approved', () => {
    expect(maySubmit(null)).toBe(true);
    expect(maySubmit(of('NONE'))).toBe(true);
    expect(maySubmit(of('REJECTED'))).toBe(true);
    expect(maySubmit(of('EXPIRED'))).toBe(true);
    expect(maySubmit(of('PENDING'))).toBe(false);
    expect(maySubmit(of('APPROVED'))).toBe(false);
  });

  it('qualifies only an approval', () => {
    expect(qualifiesForStudentPlans(of('APPROVED'))).toBe(true);
    expect(qualifiesForStudentPlans(of('PENDING'))).toBe(false);
    expect(qualifiesForStudentPlans(of('EXPIRED'))).toBe(false);
    expect(qualifiesForStudentPlans(null)).toBe(false);
  });
});

describe('studentSubmissionRefusalOf', () => {
  it('maps codes before statuses', () => {
    expect(studentSubmissionRefusalOf(409, 'STUDENT_CARD_IN_USE')).toBe('cardInUse');
    expect(studentSubmissionRefusalOf(409, 'STUDENT_VERIFICATION_ALREADY_SUBMITTED')).toBe('alreadySubmitted');
    expect(studentSubmissionRefusalOf(400, 'EMPTY')).toBe('emptyFile');
    expect(studentSubmissionRefusalOf(400, 'UNSUPPORTED_TYPE')).toBe('unsupportedFile');
    expect(studentSubmissionRefusalOf(400, 'TOO_LARGE')).toBe('tooLarge');
    expect(studentSubmissionRefusalOf(413, null)).toBe('tooLarge');
    expect(studentSubmissionRefusalOf(503, 'DOCUMENT_STORAGE_UNAVAILABLE')).toBe('storageUnavailable');
    expect(studentSubmissionRefusalOf(401, null)).toBe('signedOut');
    expect(studentSubmissionRefusalOf(500, null)).toBe('generic');
  });
});
