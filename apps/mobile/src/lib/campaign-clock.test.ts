import { daysLeftOf } from '@ideanest/campaign/days-left';
import { msUntilClockChange } from './campaign-clock';

/**
 * The campaign page's clock (#155): when the next answer that depends on the time changes, so one
 * timer set to that moment is all the page needs.
 */

const DEADLINE = '2026-10-04T12:00:00Z';
const at = (iso: string) => new Date(iso);

describe('msUntilClockChange', () => {
  it('is the next whole-day boundary before the deadline, just past it', () => {
    const now = at('2026-10-01T18:00:00Z'); // 2 days 18 hours left
    const wait = msUntilClockChange(DEADLINE, now) as number;
    expect(wait).toBe(18 * 3_600_000 + 1);
    expect(daysLeftOf(DEADLINE, new Date(now.getTime() + wait - 2))).toBe(2);
    expect(daysLeftOf(DEADLINE, new Date(now.getTime() + wait))).toBe(1);
  });

  it('is the deadline itself on the last day', () => {
    expect(msUntilClockChange(DEADLINE, at('2026-10-04T11:59:00Z'))).toBe(60_001);
  });

  it('is a whole day from exactly a day boundary', () => {
    expect(msUntilClockChange(DEADLINE, at('2026-10-03T12:00:00Z'))).toBe(86_400_001);
  });

  it('is nothing once the deadline has passed, or for a value that is not one', () => {
    expect(msUntilClockChange(DEADLINE, at('2026-10-04T12:00:00Z'))).toBeNull();
    expect(msUntilClockChange('not a date', at('2026-10-01T00:00:00Z'))).toBeNull();
  });
});
