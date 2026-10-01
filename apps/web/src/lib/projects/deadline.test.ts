import { describe, expect, it } from 'vitest';
import { countdownLabel, formatDay, formatInstant, remainingUntil, SERVER_TIME_ZONE } from './deadline';
import { readCampaignPage } from './publicPage';
import type { ProjectPageResponse } from '../api/server';
import type { Remaining } from './deadline';
import { campaignCountdownCopyFrom } from '../i18n/campaign-copy';
import { translatorFor } from '../../test-copy';
import en from '@ideanest/messages/en.json';

/** The English units, through the same builder the page calls — never retyped (#142). */
const EN_UNITS = campaignCountdownCopyFrom(translatorFor('campaign')).units;

function left(days: number, hours: number): Remaining {
  return {
    past: false,
    days,
    hours,
    minutes: 0,
    seconds: 0,
    totalSeconds: (days * 24 + hours) * 3600,
  };
}

/**
 * §4.4's countdown and its "deadline in the viewer's timezone" — #281.
 *
 * The countdown's arithmetic is tested in `packages/campaign` since #155. What is here is the
 * web's: writing an instant out, the page projection's agreement with the countdown, and the
 * copy builder handing the catalogue's units through unchanged.
 *
 * WHAT THESE COVER:
 *
 *   - **nothing goes negative.** A campaign that closed a fortnight ago has no days left, and
 *     a negative countdown is a number nobody has a sentence for.
 *   - **the countdown and `daysLeft` cannot drift.** Two surfaces on one page read the same
 *     instant, and a header saying "2 days left" beside a sentence naming a date that has
 *     passed is a page a backer cannot trust with money. The invariant is asserted against
 *     the real `readCampaignPage`, not against a copy of its arithmetic.
 *   - **the tick is not one second for a fortnight.** Eighty-six thousand renders a day to
 *     change a number that changes hourly is a cost paid on the route #119 exists for.
 *   - **the instant always names its zone.** "29 August at 13:00" is ambiguous by exactly the
 *     number of hours that decides whether somebody still has time to pledge.
 */

const NOW = new Date('2026-08-19T12:00:00Z');

function at(iso: string) {
  const remaining = remainingUntil(iso, NOW);
  if (remaining === null) throw new Error('The fixture is not an instant');
  return remaining;
}

/**
 * The invariant the module comment states: the whole-day figure the badge and the structured
 * data agree on is exactly the floor of the countdown, because both are computed from one
 * `deadline`.
 */
describe('the countdown and the page projection agree', () => {
  it('gives the same number of whole days as readCampaignPage', () => {
    for (const deadline of [
      '2026-08-19T12:00:01Z',
      '2026-08-20T11:59:59Z',
      '2026-08-21T14:30:45Z',
      '2026-09-30T00:00:00Z',
    ]) {
      const page = readCampaignPage(
        {
          id: 'p1',
          slug: 'a-campaign',
          state: 'LIVE',
          title: 'A campaign',
          creator: { slug: 'ayan', name: 'Ayan Q' },
          pledged: { amount: '1.00', currency: 'AZN' },
          deadline,
        } as ProjectPageResponse,
        'ayan',
        NOW,
      );

      expect(page?.daysLeft).toBe(at(deadline).days);
    }
  });
});

describe('writing an instant out', () => {
  it('always names the zone, because the hour alone is ambiguous', () => {
    const text = formatInstant('2026-08-29T12:00:00Z', SERVER_TIME_ZONE, 'en');

    expect(text).not.toBeNull();
    expect(text).toContain('29 August 2026');
    expect(text).toMatch(/UTC|GMT/u);
  });

  it('writes the same instant differently in a different zone', () => {
    const utc = formatInstant('2026-08-29T22:00:00Z', 'UTC', 'en');
    const baku = formatInstant('2026-08-29T22:00:00Z', 'Asia/Baku', 'en');

    // Four hours ahead, so the campaign closes on the thirtieth for a reader in Baku. That
    // difference is the entire reason §4.4 asks for the reader's own zone.
    expect(baku).toContain('30 August 2026');
    expect(utc).toContain('29 August 2026');
  });

  it('omits the time where only the day says anything', () => {
    expect(formatDay('2026-08-29T12:00:00Z', SERVER_TIME_ZONE, 'en')).toBe('29 August 2026');
  });

  /**
   * #324. The pin to `en-GB` carried a note saying "when the language is chosen per reader,
   * this constant is what a locale is threaded into"; #123 chose it, and this is the thread.
   * The hydration argument the pin protected is unchanged — both renders read the same
   * `[locale]` segment — so the zone is still the only thing allowed to differ between them.
   */
  it('writes the same instant in the reader’s own language', () => {
    expect(formatDay('2026-08-29T12:00:00Z', SERVER_TIME_ZONE, 'az')).toBe('29 avqust 2026');
    expect(formatDay('2026-08-29T12:00:00Z', SERVER_TIME_ZONE, 'tr')).toBe('29 Ağustos 2026');
    expect(formatDay('2026-08-29T12:00:00Z', SERVER_TIME_ZONE, 'ru')).toBe('29 августа 2026 г.');
  });

  /**
   * A browser can report a zone name a given ICU build does not know. Answering null lets the
   * caller keep what the server already rendered rather than printing "Invalid Date" into a
   * sentence about somebody's deadline.
   */
  it('answers null for a zone the runtime refuses and for a value that is not an instant', () => {
    expect(formatInstant('2026-08-29T12:00:00Z', 'Mars/Olympus_Mons', 'en')).toBeNull();
    expect(formatInstant('soon', SERVER_TIME_ZONE, 'en')).toBeNull();
  });
});

describe('the copy builder', () => {
  it('hands the catalogue’s units to the shared label unchanged', () => {
    expect(EN_UNITS).toEqual({ ...en.campaign.countdown.units, pair: en.campaign.countdown.pair });
    expect(countdownLabel(left(2, 3), EN_UNITS, 'en')).toBe('2 days, 3 hours');
  });
});
