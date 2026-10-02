import { describe, expect, it } from 'vitest';
import { reservationClockAt, reservationLabel } from './reservation';

describe('reservation clock', () => {
  it('labels 5:00, 0:59 and 0:00', () => {
    expect(reservationLabel(300_000)).toBe('5:00');
    expect(reservationLabel(59_000)).toBe('0:59');
    expect(reservationLabel(58_001)).toBe('0:59');
    expect(reservationLabel(0)).toBe('0:00');
  });

  it('expires at zero and never goes negative', () => {
    const at = Date.parse('2026-10-02T10:05:00Z');
    expect(reservationClockAt('2026-10-02T10:05:00Z', at)).toEqual({ remainingMs: 0, expired: true, label: '0:00' });
    expect(reservationClockAt('2026-10-02T10:05:00Z', at + 60_000).remainingMs).toBe(0);
    expect(reservationClockAt('2026-10-02T10:05:00Z', at - 61_000)).toEqual({
      remainingMs: 61_000,
      expired: false,
      label: '1:01',
    });
  });

  it('has no clock without a deadline', () => {
    expect(reservationClockAt(null, 0)).toEqual({ remainingMs: 0, expired: false, label: '' });
    expect(reservationClockAt('not a date', 0).expired).toBe(false);
  });
});
