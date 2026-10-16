import { describe, expect, it } from 'vitest';
import { bakuDate, calendarDate } from './console-dates';
import { codedRefusalFor, isIdentifier } from './coded-refusal';
import { ApiError } from '../api/problem';
import { fixedFrom, formatFixedAmount, plainRate, rateFrom } from './fees';

describe('dates on the money screens', () => {
  it('reads an instant as the day it is in Baku, not in UTC', () => {
    // 21:30 UTC on the 14th is 01:30 on the 15th in Baku.
    expect(bakuDate('2026-10-14T21:30:00Z', 'en')).toBe('15 Oct 2026');
    expect(bakuDate('2026-10-14T21:30:00Z', 'az')).toContain('15');
  });

  it('formats a value date without moving it across a zone', () => {
    expect(calendarDate('2026-10-03', 'en')).toBe('3 Oct 2026');
    expect(calendarDate('not a day', 'en')).toBe('not a day');
  });
});

describe('a refusal in the screen own words', () => {
  const refusals = {
    refused: 'refused',
    unreachable: 'unreachable',
    notStaff: 'not staff {subject}',
    needsCapability: 'needs {capability}',
  } as unknown as Parameters<typeof codedRefusalFor>[4];

  it('prefers the sentence for the code, says a codeless 400 in words, and never passes the detail on', () => {
    const words = { KNOWN: 'known' };
    expect(codedRefusalFor(new ApiError(409, { code: 'KNOWN', detail: 'English' }), words, 'invalid', 's', refusals)).toBe('known');
    expect(codedRefusalFor(new ApiError(400, { detail: 'Invalid request content.' }), words, 'invalid', 's', refusals)).toBe(
      'invalid',
    );
    expect(codedRefusalFor(new ApiError(409, { code: 'OTHER', detail: 'English' }), words, 'invalid', 's', refusals)).toBe(
      'refused',
    );
    expect(codedRefusalFor(new Error('offline'), words, 'invalid', 's', refusals)).toBe('unreachable');
  });

  it('knows a whole identifier from a fragment', () => {
    expect(isIdentifier('b2a00000-0000-4000-8000-000000000002')).toBe(true);
    expect(isIdentifier('b2a00000')).toBe(false);
  });
});

describe('fee terms as typed', () => {
  it('reads a decimal comma, refuses a percentage typed as a whole number, and keeps the column scale', () => {
    expect(rateFrom('0,05')).toBe('0.05');
    expect(rateFrom('1')).toBe('1');
    expect(rateFrom('15')).toBeUndefined();
    expect(rateFrom('0.123456')).toBeUndefined();
    expect(fixedFrom('0,30')).toBe('0.30');
    expect(fixedFrom('-1')).toBeUndefined();
  });

  it('prints a fixed amount with every decimal that is not a trailing zero', () => {
    expect(formatFixedAmount('0.3000', 'AZN')).toBe('0.30 AZN');
    expect(formatFixedAmount('0.0025', 'AZN')).toBe('0.0025 AZN');
    expect(formatFixedAmount('1200.5000', 'AZN')).toBe('1,200.50 AZN');
    expect(plainRate('0.15000')).toBe('0.15');
    expect(plainRate('0.00000')).toBe('0');
  });
});
