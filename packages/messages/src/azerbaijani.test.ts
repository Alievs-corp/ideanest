import { describe, expect, it } from 'vitest';
import {
  azerbaijaniDateTimeFormat,
  azerbaijaniNumberFormat,
  azerbaijaniRelativeTimeFormat,
} from './azerbaijani';
import { dateTimeFormat, numberFormat, relativeTimeFormat } from './formats';

/**
 * Azerbaijani, asserted twice — issue #401.
 *
 * <h2>Once against the strings, and once against ICU</h2>
 *
 * <p>The literal assertions are the ones that matter and the ones that always run: they say
 * what an Azerbaijani reader is owed, and they would fail on the root-locale output — `-3 w`,
 * `2026 M08 14`, `9/1/2026`, `11:06 PM` — that Chromium produces for `az` today.
 *
 * <p>The parity block is the one that keeps the table honest. Node's ICU has real `az` data,
 * so the same instants can be put through both and compared, byte for byte, including the
 * `/` glue that a long date takes and the `, ` a medium one takes. It is skipped where the
 * engine has no `az` data of its own, because there it would be comparing this module against
 * the bug it exists to route around — and the check for that is not `supportedLocalesOf`,
 * which answers `['az']` on exactly the engine that cannot do it.
 *
 * <p>What is deliberately not here is a jsdom render. The whole defect is invisible under
 * Node's ICU, so a component test would pass today, pass tomorrow, and never see it. The only
 * test that could is one running in a browser engine, and this suite does not have one; what
 * it can do is make the browser stop asking the engine.
 */

/** Azerbaijan Standard Time, which is what a reader in Baku is looking at. */
const BAKU = 'Asia/Baku';

/** 14 August 2026, 23:06:12 in Baku. A Friday, and the instant the issue reports. */
const AUGUST = new Date('2026-08-14T19:06:12Z');

/** 1 September 2026, and a single-digit hour, so a padding mistake shows. */
const SEPTEMBER = new Date('2026-09-01T05:06:12Z');

/**
 * Whether this engine has Azerbaijani data rather than merely claiming to.
 *
 * <p>`supportedLocalesOf` is the wrong question — it answers `['az']` on Chromium, which then
 * formats `-3 w`. The right one is what it actually renders.
 *
 * <p>Probed on two strings that carry a letter outside ASCII in Azerbaijani and none in the
 * root locale: "3 həftə öncə" against `-3 w`, and Friday's "cümə" against `Fri`. Not on a
 * month name — most of them, `avqust` and `sentyabr` among them, are ASCII throughout, which
 * is the kind of thing a probe gets wrong quietly.
 */
function engineHasAzerbaijani(): boolean {
  const beyondAscii = (text: string) => [...text].some((letter) => letter.codePointAt(0)! > 127);
  return (
    beyondAscii(new Intl.RelativeTimeFormat('az', { numeric: 'auto' }).format(-3, 'week')) &&
    beyondAscii(
      new Intl.DateTimeFormat('az', { weekday: 'long', timeZone: 'Asia/Baku' }).format(AUGUST),
    )
  );
}

describe('Azerbaijani relative times', () => {
  it('says how long ago in Azerbaijani, not in signed English abbreviations', () => {
    const relative = azerbaijaniRelativeTimeFormat({ numeric: 'auto' });

    // What `/az/admin/moderation` rendered as `-3 w`, `-2 w` and `last week` — three formats
    // in one list, two of them English.
    expect(relative.format(-3, 'week')).toBe('3 həftə öncə');
    expect(relative.format(-2, 'week')).toBe('2 həftə öncə');
    expect(relative.format(-1, 'week')).toBe('keçən həftə');
  });

  it('uses the language own words for the counts that have one', () => {
    const relative = azerbaijaniRelativeTimeFormat({ numeric: 'auto' });

    expect(relative.format(0, 'second')).toBe('indi');
    expect(relative.format(-1, 'day')).toBe('dünən');
    expect(relative.format(1, 'day')).toBe('sabah');
    expect(relative.format(-1, 'year')).toBe('keçən il');
  });

  it('counts in figures when asked to, exactly as Intl does', () => {
    const always = azerbaijaniRelativeTimeFormat({ numeric: 'always' });

    // `numeric: 'always'` is the caller saying it wants a count rather than a word, and a
    // formatter that returned "dünən" anyway would be answering a different question.
    expect(always.format(-1, 'day')).toBe('1 gün öncə');
    expect(always.format(1, 'day')).toBe('1 gün ərzində');
  });

  it('takes a plural unit name, because Intl does', () => {
    const relative = azerbaijaniRelativeTimeFormat({ numeric: 'auto' });

    expect(relative.format(-3, 'weeks')).toBe('3 həftə öncə');
  });
});

describe('Azerbaijani dates', () => {
  it('renders a medium date and a 24-hour clock', () => {
    const format = azerbaijaniDateTimeFormat({
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BAKU,
    });

    // The console rendered `7/27/2026, 11:06:06 PM` here: a month-first date and a
    // twelve-hour clock, on a platform whose other three languages all render neither.
    expect(format.format(AUGUST)).toBe('14 avq 2026, 23:06');
    expect(format.format(SEPTEMBER)).toBe('1 sen 2026, 09:06');
  });

  it('renders a full date with the weekday after it', () => {
    const format = azerbaijaniDateTimeFormat({ dateStyle: 'full', timeZone: BAKU });

    expect(format.format(AUGUST)).toBe('14 avqust 2026, cümə');
  });

  it('renders a numeric date with dots and a two-digit year', () => {
    const format = azerbaijaniDateTimeFormat({ dateStyle: 'short', timeZone: BAKU });

    expect(format.format(AUGUST)).toBe('14.08.26');
  });

  it('renders the month and year a delivery window is written in', () => {
    const format = azerbaijaniDateTimeFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' });

    expect(format.format(AUGUST)).toBe('avqust 2026');
  });

  it('renders an instant with its zone', () => {
    const format = azerbaijaniDateTimeFormat({
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: BAKU,
    });

    expect(format.format(AUGUST)).toBe('14 avqust 2026/23:06 GMT+4');
  });

  it('reads the weekday in the reader zone rather than in Greenwich', () => {
    // 01:30 on the 15th in Baku is 21:30 on the 14th in UTC. A weekday taken from the
    // timestamp rather than from the zoned calendar date would say Friday.
    const format = azerbaijaniDateTimeFormat({ dateStyle: 'full', timeZone: BAKU });

    expect(format.format(new Date('2026-08-14T21:30:00Z'))).toBe('15 avqust 2026, şənbə');
  });
});

describe('Azerbaijani numbers', () => {
  it('groups with a dot and points with a comma', () => {
    const format = azerbaijaniNumberFormat({ maximumFractionDigits: 3 });

    // Chromium's `az` is the root locale here too, so it grouped with a comma and pointed
    // with a dot — the opposite of both — which is #403's `2.9%` beside a `2,9%` typed by a
    // person into the note next to it.
    expect(format.format(1234.5)).toBe('1.234,5');
    expect(format.format(2.9)).toBe('2,9');
    expect(format.format(-0.125)).toBe('-0,125');
  });

  it('writes a percentage the way Azerbaijani writes one', () => {
    const format = azerbaijaniNumberFormat({ style: 'percent', maximumFractionDigits: 3 });

    expect(format.format(0.05)).toBe('5%');
    expect(format.format(0.029)).toBe('2,9%');
  });

  it('leaves the other three languages to Intl, sign and separator both', () => {
    const percent = { style: 'percent', maximumFractionDigits: 3 } as const;

    expect(numberFormat('az', percent, 'test-rate').format(0.029)).toBe('2,9%');
    expect(numberFormat('en', percent, 'test-rate').format(0.029)).toBe('2.9%');
    // Russian puts a space before the sign and Turkish puts the sign in front of the
    // number, which is why this is a formatter's job and not a template's.
    expect(numberFormat('ru', percent, 'test-rate').format(0.029)).toBe('2,9 %');
    expect(numberFormat('tr', percent, 'test-rate').format(0.029)).toBe('%2,9');
  });
});

describe('the formatter table', () => {
  it('sends Azerbaijani to this module and leaves the other three to Intl', () => {
    expect(relativeTimeFormat('az', { numeric: 'auto' }, 'test-relative').format(-3, 'week')).toBe(
      '3 həftə öncə',
    );

    // Unchanged, and asserted so that a change here cannot quietly reroute them.
    expect(relativeTimeFormat('en', { numeric: 'auto' }, 'test-relative').format(-3, 'week')).toBe(
      '3 weeks ago',
    );
    expect(
      dateTimeFormat('en', { dateStyle: 'medium', timeZone: BAKU }, 'test-date').format(AUGUST),
    ).toBe('14 Aug 2026');
  });
});

describe.skipIf(!engineHasAzerbaijani())('against an engine that does have the data', () => {
  const DATE_OPTIONS: readonly Intl.DateTimeFormatOptions[] = [
    { dateStyle: 'full', timeZone: BAKU },
    { dateStyle: 'long', timeZone: BAKU },
    { dateStyle: 'medium', timeZone: BAKU },
    { dateStyle: 'short', timeZone: BAKU },
    { dateStyle: 'full', timeStyle: 'short', timeZone: BAKU },
    { dateStyle: 'long', timeStyle: 'short', timeZone: BAKU },
    { dateStyle: 'medium', timeStyle: 'short', timeZone: BAKU },
    { dateStyle: 'medium', timeStyle: 'medium', timeZone: BAKU },
    { dateStyle: 'short', timeStyle: 'short', timeZone: BAKU },
    { dateStyle: 'long', timeZone: 'UTC' },
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: BAKU },
    { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: BAKU },
    { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: BAKU },
    { hour: 'numeric', minute: '2-digit', timeZone: BAKU },
    { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: BAKU },
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: BAKU,
    },
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: BAKU },
  ];

  const INSTANTS: readonly Date[] = [
    AUGUST,
    SEPTEMBER,
    new Date('2026-01-31T22:00:00Z'),
    new Date('2026-12-01T00:00:00Z'),
    new Date('2026-03-08T20:00:00Z'),
    new Date('2026-06-30T23:59:59Z'),
  ];

  it.each(DATE_OPTIONS)('matches ICU for %j', (options) => {
    const ours = azerbaijaniDateTimeFormat(options);
    const icu = new Intl.DateTimeFormat('az', options);

    for (const instant of INSTANTS) {
      expect(ours.format(instant)).toBe(icu.format(instant));
    }
  });

  it('matches ICU for the numbers a rate is written with', () => {
    for (const options of [
      { maximumFractionDigits: 3 },
      { style: 'percent', maximumFractionDigits: 3 },
      { style: 'percent', maximumFractionDigits: 0 },
    ] as const) {
      const ours = azerbaijaniNumberFormat(options);
      const icu = new Intl.NumberFormat('az', options);

      for (const value of [0, 0.00125, 0.029, 0.05, 1, 12.5, 1234.5, 1234567.891, -0.125, -1234.5]) {
        expect(ours.format(value)).toBe(icu.format(value));
      }
    }
  });

  it('matches ICU for every relative unit and count in use', () => {
    const units: readonly Intl.RelativeTimeFormatUnit[] = [
      'second',
      'minute',
      'hour',
      'day',
      'week',
      'month',
      'year',
    ];

    for (const numeric of ['auto', 'always'] as const) {
      const ours = azerbaijaniRelativeTimeFormat({ numeric });
      const icu = new Intl.RelativeTimeFormat('az', { numeric });

      for (const unit of units) {
        for (const count of [-59, -12, -3, -2, -1, 0, 1, 2, 3, 12, 59]) {
          expect(ours.format(count, unit)).toBe(icu.format(count, unit));
        }
      }
    }
  });
});
