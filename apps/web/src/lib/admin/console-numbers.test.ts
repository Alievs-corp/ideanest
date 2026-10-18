import { describe, expect, it } from 'vitest';
import { addDays, bakuToday, lastDays } from './baku-calendar';
import { formatCount, formatPercent, formatShare } from './console-numbers';

describe('counts and rates on the figure screens', () => {
  it('groups a count the way the reader’s language does', () => {
    expect(formatCount(1234567, 'en')).toBe('1,234,567');
    expect(formatCount('1234', 'az')).toBe('1.234');
    expect(formatCount(1234, 'ru')).toMatch(/^1\s234$/);
  });

  it('leaves something that is not a number as it came', () => {
    expect(formatCount('n/a', 'en')).toBe('n/a');
    expect(formatPercent('n/a', 'en')).toBe('n/a');
  });

  it('prints a rate to at most two places, the same from a per-cent string and from a fraction', () => {
    expect(formatPercent('66.67', 'en')).toBe('66.67%');
    expect(formatShare(2 / 3, 'en')).toBe('66.67%');
    expect(formatPercent('80.00', 'en')).toBe('80%');
    expect(formatPercent('66.67', 'az')).toBe('66,67%');
  });
});

describe('the platform calendar', () => {
  it('reads today in Baku, which is already tomorrow for four hours of each night in UTC', () => {
    expect(bakuToday(new Date('2050-06-14T21:30:00Z'))).toBe('2050-06-15');
    expect(bakuToday(new Date('2050-06-14T19:30:00Z'))).toBe('2050-06-14');
  });

  it('counts a window back in calendar days, both ends included', () => {
    expect(lastDays(30, '2050-06-15')).toEqual({ from: '2050-05-17', to: '2050-06-15' });
    expect(lastDays(1, '2050-06-15')).toEqual({ from: '2050-06-15', to: '2050-06-15' });
    expect(addDays('2050-03-01', -1)).toBe('2050-02-28');
  });
});
