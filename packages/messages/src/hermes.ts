import {
  MONTHS,
  WEEKDAYS,
  monthStyle,
  weekdayStyle,
  type AzerbaijaniDateTimeFormat,
  type AzerbaijaniNumberFormat,
} from './azerbaijani';

/**
 * Azerbaijani on an engine without `formatToParts` — Hermes, issue #150.
 *
 * <h2>Why the app needs this and the web does not</h2>
 *
 * <p>`azerbaijani.ts` writes numbers and dates from the parts `en-GB` renders them in. Hermes
 * has no `Intl.DateTimeFormat.prototype.formatToParts` on either platform and no `NumberFormat`
 * one on iOS, so without this an iPhone printed `1234567` and the ISO day where an Azerbaijani
 * reader is owed `1.234.567` and `14 avq 2026` — worse than the platform's own formatting it
 * replaced. Every browser has both methods, so this module is the app's alone: it is not in
 * the package root, nothing in the web imports it, and `azerbaijani.ts` does not know it
 * exists — the web's bundles carry not one byte of it, which its First Load JS budgets need.
 *
 * <h2>Asked, not assumed</h2>
 *
 * <p>{@link formatToPartsWorks} tests each method once, on a known value, and the app's
 * `lib/i18n.tsx` picks the formatters below only for what fails. "Fails" includes a method
 * that exists and answers nothing: that would write an empty string, which is worse than
 * either answer. On Node, in a browser, and for numbers on Android, both work.
 *
 * <p>The words and their order are `azerbaijani.ts`'s tables; {@link written} repeats its
 * composition over them rather than sharing it, because sharing it would mean reshaping the
 * web's copy. `azerbaijani.test.ts` holds the two to the same output, shape by shape.
 */

/** Whether `formatToParts` answers a known value with the parts that value has. */
function partsWork(
  read: () => readonly { type: string; value: string }[],
  type: string,
  value: string,
): boolean {
  try {
    return read().some((part) => part.type === type && part.value === value);
  } catch {
    return false;
  }
}

/**
 * Numbers from the finished string: `en-GB` writes no comma or full stop in a number except its
 * two separators, so exchanging every one of them is exchanging exactly those — the same answer
 * the parts reading gives, currency and percent options included.
 */
export function partlessAzerbaijaniNumberFormat(options: Intl.NumberFormatOptions): AzerbaijaniNumberFormat {
  const rendered = new Intl.NumberFormat('en-GB', options);
  return {
    format: (value) =>
      rendered.format(value).replace(/[.,]/gu, (mark) => (mark === ',' ? '.' : ',')),
  };
}

/** Options the reading below does not reproduce; the engine's own `az` gets them. */
const UNREAD: readonly (keyof Intl.DateTimeFormatOptions)[] = [
  'timeZoneName',
  'era',
  'dayPeriod',
  'fractionalSecondDigits',
  'hour12',
  'hourCycle',
  'calendar',
  'numberingSystem',
];

/** Every run of digits in `text`, as numbers — the only thing read from a part-less string. */
function digitsOf(text: string): number[] {
  return (text.match(/\d+/gu) ?? []).map(Number);
}

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/**
 * The fields `azerbaijani.ts` reads from parts, from `format()` alone.
 *
 * <p>It covers what callers pass: every `dateStyle`, `timeStyle` `short` and `medium`, the
 * explicit day, month, year and weekday fields, an hour with minutes and seconds, and a
 * `timeZone`. The zoned numbers come from `en-GB` asked for digits only, whose order is fixed
 * (day, month, year; hours, minutes, seconds) and whose digits are the only thing read, so no
 * separator or spacing can mislead it. Padding follows `en-GB`'s own, which is what the parts
 * reading passes through; `azerbaijani.test.ts` holds the two to the same output. Anything
 * else — a zone name, a twelve-hour clock — is the engine's own `az`, which is what the app
 * printed before this package formatted for it.
 */
export function partlessAzerbaijaniDateTimeFormat(
  options: Intl.DateTimeFormatOptions,
): AzerbaijaniDateTimeFormat {
  const engine = new Intl.DateTimeFormat('az', options);
  const lonely = options.minute !== undefined || options.second !== undefined;
  if (
    UNREAD.some((option) => options[option] !== undefined) ||
    options.timeStyle === 'long' ||
    options.timeStyle === 'full' ||
    // Minutes or seconds with no hour: `en-GB` does not pad a lone minute, and nobody asks.
    (options.hour === undefined && lonely)
  ) {
    return engine;
  }

  const explicitDate =
    options.day !== undefined ||
    options.month !== undefined ||
    options.year !== undefined ||
    options.weekday !== undefined;
  const wantsTime = options.timeStyle !== undefined || options.hour !== undefined;
  // `Intl`'s own default: no field and no style asked for is a numeric date.
  const numericDefault = options.dateStyle === undefined && !explicitDate && !wantsTime;
  const styled = options.dateStyle !== undefined || numericDefault;
  const month = monthStyle(options);
  const numericMonth = numericDefault || month === 'numeric' || month === '2-digit';
  const withMinutes = options.timeStyle !== undefined || options.minute !== undefined;
  const withSeconds =
    options.timeStyle === 'medium' ||
    (options.timeStyle === undefined && options.second !== undefined);
  // `en-GB`'s rule: a styled clock and a lone hour are padded, `hour: 'numeric'` beside
  // minutes is not — `9:06`, which is also what Azerbaijani ICU writes.
  const paddedHour = options.timeStyle !== undefined || options.hour === '2-digit' || !withMinutes;

  const calendar = new Intl.DateTimeFormat('en-GB', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: options.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  });

  return {
    format(value: Date | number): string {
      const at = typeof value === 'number' ? new Date(value) : value;

      let [day, monthNumber, year] = digitsOf(calendar.format(at));
      if (day === undefined || monthNumber === undefined || year === undefined || year < 1000) {
        // No zone asked for means the device's, which the `Date` itself can answer.
        if (options.timeZone !== undefined) return engine.format(at);
        [day, monthNumber, year] = [at.getDate(), at.getMonth() + 1, at.getFullYear()];
      }

      const fields: Record<string, string> = {};
      if (styled || options.day !== undefined) {
        fields.day = numericMonth || options.day === '2-digit' ? twoDigits(day) : String(day);
      }
      if (styled || options.month !== undefined) {
        // A spelled-out month is written from the table; only its presence matters here.
        fields.month = numericMonth ? twoDigits(monthNumber) : String(monthNumber);
      }
      if (styled || options.year !== undefined) {
        fields.year = options.year === '2-digit' ? String(year).slice(-2) : String(year);
      }
      if (weekdayStyle(options) !== undefined) fields.weekday = '';

      if (wantsTime) {
        const [hour, minute, second] = digitsOf(clock.format(at));
        if (hour === undefined || minute === undefined || (withSeconds && second === undefined)) {
          return engine.format(at);
        }
        fields.hour = paddedHour ? twoDigits(hour) : String(hour);
        if (withMinutes) fields.minute = twoDigits(minute);
        if (withSeconds) fields.second = twoDigits(second!);
      }

      return written(options, fields, [year, monthNumber, day]);
    },
  };
}

/**
 * `azerbaijaniDateTimeFormat`'s composition, over the fields read above: the same tables, the
 * same order, the same glue. Kept in step by `azerbaijani.test.ts`, which requires every date
 * shape it knows to come out of both identically.
 */
function written(
  options: Intl.DateTimeFormatOptions,
  fields: Readonly<Record<string, string | undefined>>,
  [year, monthNumber, day]: readonly [number, number, number],
): string {
  const month = monthStyle(options);
  const weekday = weekdayStyle(options);
  const spelledOut = month === 'long' || month === 'short' || month === 'narrow';
  const monthIndex = monthNumber - 1;
  const dayIndex = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
  const present = (piece: string | undefined): piece is string =>
    piece !== undefined && piece !== '';

  let date = '';
  if (fields.month !== undefined && spelledOut) {
    const name = MONTHS[month as 'long' | 'short' | 'narrow'][monthIndex] ?? fields.month;
    date = [fields.day, name, fields.year].filter(present).join(' ');
  } else if (fields.month !== undefined) {
    const shown = options.dateStyle === 'short' ? fields.year?.slice(-2) : fields.year;
    date = [fields.day, fields.month, shown].filter(present).join('.');
  } else {
    date = [fields.day, fields.year].filter(present).join(' ');
  }

  if (weekday !== undefined && fields.weekday !== undefined) {
    const name = WEEKDAYS[weekday as 'long' | 'short' | 'narrow'][dayIndex] ?? fields.weekday;
    date = date === '' ? name : `${date}, ${name}`;
  }

  const time = [fields.hour, fields.minute, fields.second].filter(present).join(':');
  if (date === '') return time;
  if (time === '') return date;
  // A long date takes `{1}/{0}` and the rest `{1}, {0}`, as in CLDR and `azerbaijani.ts`.
  return `${date}${spelledOut && month === 'long' ? '/' : ', '}${time}`;
}

/** 14 August 2026 in UTC — a day number no other field of it shares. */
const PROBE = new Date(Date.UTC(2026, 7, 14, 12));

/**
 * Which of the two `formatToParts` this engine can be trusted with. Asked by the app once,
 * before its first formatter; the answer is a property of the engine.
 */
export function formatToPartsWorks(): { readonly numbers: boolean; readonly dates: boolean } {
  return {
    numbers: partsWork(() => new Intl.NumberFormat('en-GB').formatToParts(1234.5), 'decimal', '.'),
    dates: partsWork(
      () =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'UTC',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
        }).formatToParts(PROBE),
      'day',
      '14',
    ),
  };
}
