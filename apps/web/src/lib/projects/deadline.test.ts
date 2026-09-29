import { describe, expect, it } from 'vitest';
import {
  countdownIntervalMs,
  countdownLabel,
  formatDay,
  formatInstant,
  remainingUntil,
  SERVER_TIME_ZONE,
} from './deadline';
import { readCampaignPage } from './publicPage';
import type { ProjectPageResponse } from '../api/server';
import type { CountdownUnits, Remaining } from './deadline';
import { campaignCountdownCopyFrom } from '../i18n/campaign-copy';
import type { Locale } from '../i18n/locale';
import { translatorFor } from '../../test-copy';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';

/** The English units, through the same builder the page calls — never retyped (#142). */
const EN_UNITS = campaignCountdownCopyFrom(translatorFor('campaign')).units;

/** Each catalogue's units, read as the builder reads them. */
function unitsOf(catalogue: typeof en): CountdownUnits {
  return { ...catalogue.campaign.countdown.units, pair: catalogue.campaign.countdown.pair };
}

const UNITS: Record<Locale, CountdownUnits> = {
  az: unitsOf(az),
  en: unitsOf(en),
  ru: unitsOf(ru),
  tr: unitsOf(tr),
};

function left(days: number, hours: number, minutes: number, seconds: number): Remaining {
  return {
    past: false,
    days,
    hours,
    minutes,
    seconds,
    totalSeconds: ((days * 24 + hours) * 60 + minutes) * 60 + seconds,
  };
}

/**
 * §4.4's countdown and its "deadline in the viewer's timezone" — #281.
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

describe('how long is left', () => {
  it('breaks the interval into days, hours, minutes and seconds', () => {
    expect(at('2026-08-21T14:30:45Z')).toMatchObject({
      past: false,
      days: 2,
      hours: 2,
      minutes: 30,
      seconds: 45,
    });
  });

  it('reports a closed campaign as past and zero rather than as a negative', () => {
    const closed = at('2026-08-01T00:00:00Z');

    expect(closed.past).toBe(true);
    expect(closed.days).toBe(0);
    expect(closed.totalSeconds).toBe(0);
  });

  it('treats the deadline itself as past, because the campaign has closed at it', () => {
    expect(at('2026-08-19T12:00:00Z').past).toBe(true);
  });

  it('answers null for a string that is not an instant', () => {
    expect(remainingUntil('the day after tomorrow', NOW)).toBeNull();
  });

  /**
   * Floored, never rounded up. A countdown that rounds prints "1 minute" for fifty-nine
   * seconds and then jumps to zero a second later; every number it shows should be a number
   * of units that genuinely remain.
   */
  it('floors to whole seconds', () => {
    const remaining = remainingUntil('2026-08-19T12:00:01.900Z', NOW);
    expect(remaining?.seconds).toBe(1);
  });
});

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

describe('the countdown label', () => {
  it('shows days and hours while there are days', () => {
    expect(countdownLabel(at('2026-08-21T14:30:45Z'), EN_UNITS, 'en')).toBe('2 days, 2 hours');
  });

  it('says one day rather than 1 days', () => {
    expect(countdownLabel(at('2026-08-20T15:00:00Z'), EN_UNITS, 'en')).toBe('1 day, 3 hours');
  });

  it('drops to hours and minutes on the last day', () => {
    expect(countdownLabel(at('2026-08-19T15:30:00Z'), EN_UNITS, 'en')).toBe('3 hours, 30 minutes');
  });

  /** The one hour of a campaign in which a second is a fact somebody is acting on. */
  it('shows seconds only in the final hour', () => {
    expect(countdownLabel(at('2026-08-19T12:04:20Z'), EN_UNITS, 'en')).toBe('4 minutes, 20 seconds');
  });

  /**
   * The wording of a closed campaign belongs to the surface showing it — "Closed", "This
   * campaign has ended" and the outcome notice are three different sentences — so this
   * answers nothing rather than inventing a fourth.
   */
  it('has no words for a campaign that has closed', () => {
    expect(countdownLabel(at('2026-08-01T00:00:00Z'), EN_UNITS, 'en')).toBeNull();
  });
});

/**
 * #142: the countdown in all four languages, for 1, 2, 5 and 21 of every unit.
 *
 * The four numbers are the ones that separate the plural rules: 1 is `one` everywhere, 2 is
 * Russian `few`, 5 is Russian `many`, and 21 is Russian `one` again — the case a ternary on
 * `=== 1` gets wrong. Azerbaijani and Turkish keep the noun singular after a number, and no
 * suffix is glued onto the number in either (#104, #109).
 */
describe('the countdown label in every language', () => {
  const EXPECTED: Record<Locale, Record<number, readonly [string, string, string]>> = {
    en: {
      1: ['1 day, 1 hour', '1 hour, 1 minute', '1 minute, 1 second'],
      2: ['2 days, 2 hours', '2 hours, 2 minutes', '2 minutes, 2 seconds'],
      5: ['5 days, 5 hours', '5 hours, 5 minutes', '5 minutes, 5 seconds'],
      21: ['21 days, 21 hours', '21 hours, 21 minutes', '21 minutes, 21 seconds'],
    },
    ru: {
      1: ['1 день, 1 час', '1 час, 1 минута', '1 минута, 1 секунда'],
      2: ['2 дня, 2 часа', '2 часа, 2 минуты', '2 минуты, 2 секунды'],
      5: ['5 дней, 5 часов', '5 часов, 5 минут', '5 минут, 5 секунд'],
      21: ['21 день, 21 час', '21 час, 21 минута', '21 минута, 21 секунда'],
    },
    az: {
      1: ['1 gün, 1 saat', '1 saat, 1 dəqiqə', '1 dəqiqə, 1 saniyə'],
      2: ['2 gün, 2 saat', '2 saat, 2 dəqiqə', '2 dəqiqə, 2 saniyə'],
      5: ['5 gün, 5 saat', '5 saat, 5 dəqiqə', '5 dəqiqə, 5 saniyə'],
      21: ['21 gün, 21 saat', '21 saat, 21 dəqiqə', '21 dəqiqə, 21 saniyə'],
    },
    tr: {
      1: ['1 gün, 1 saat', '1 saat, 1 dakika', '1 dakika, 1 saniye'],
      2: ['2 gün, 2 saat', '2 saat, 2 dakika', '2 dakika, 2 saniye'],
      5: ['5 gün, 5 saat', '5 saat, 5 dakika', '5 dakika, 5 saniye'],
      21: ['21 gün, 21 saat', '21 saat, 21 dakika', '21 dakika, 21 saniye'],
    },
  };

  const CASES = (['en', 'ru', 'az', 'tr'] as const).flatMap((locale) =>
    [1, 2, 5, 21].map((count) => [locale, count] as const),
  );

  it.each(CASES)('declines days and hours in %s for %i', (locale, count) => {
    expect(countdownLabel(left(count, count, 0, 0), UNITS[locale], locale)).toBe(
      EXPECTED[locale][count]?.[0],
    );
  });

  it.each(CASES)('declines hours and minutes in %s for %i', (locale, count) => {
    expect(countdownLabel(left(0, count, count, 0), UNITS[locale], locale)).toBe(
      EXPECTED[locale][count]?.[1],
    );
  });

  it.each(CASES)('declines minutes and seconds in %s for %i', (locale, count) => {
    expect(countdownLabel(left(0, 0, count, count), UNITS[locale], locale)).toBe(
      EXPECTED[locale][count]?.[2],
    );
  });

  it('never glues an Azerbaijani suffix onto the number', () => {
    for (const forms of Object.values(az.campaign.countdown.units)) {
      for (const form of Object.values(forms)) expect(form).toMatch(/^\{count\} \p{L}+$/u);
    }
  });
});

describe('how often the countdown has something new to say', () => {
  it('ticks once a minute while the smallest unit shown is a minute', () => {
    expect(countdownIntervalMs(at('2026-08-21T14:30:45Z'))).toBe(60_000);
    expect(countdownIntervalMs(at('2026-08-19T13:30:00Z'))).toBe(60_000);
  });

  it('ticks once a second inside the final hour, where seconds are shown', () => {
    expect(countdownIntervalMs(at('2026-08-19T12:30:00Z'))).toBe(1_000);
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
