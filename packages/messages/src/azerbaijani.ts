/**
 * Azerbaijani dates and relative times, written out — issue #401.
 *
 * <h2>The browser claims `az` and then formats it from root-locale data</h2>
 *
 * <p>Chromium ships an ICU that answers `Intl.RelativeTimeFormat.supportedLocalesOf(['az'])`
 * with `['az']` and `new Intl.RelativeTimeFormat('az').resolvedOptions().locale` with `'az'`,
 * and then formats `-3 w`. `new Intl.DateTimeFormat('az', { dateStyle: 'medium' })` renders
 * `2026 M08 14` — `M08` is the root locale's month pattern, which is not a language. Node's
 * full ICU has the real data, so every one of these is right on the server, right in every
 * test, and wrong in front of the reader. `ru` and `tr` are unaffected in both.
 *
 * <p>The trap is that the standard feature test cannot see it. Both `supportedLocalesOf` and
 * `resolvedOptions().locale` report support, so anything that asks the engine whether it
 * knows Azerbaijani is told yes.
 *
 * <h2>Why this is not a probe, and not a polyfill</h2>
 *
 * <p><strong>Not a probe</strong> — "use the engine's `az` when it looks right, ours when it
 * does not" makes the output depend on which engine rendered it, and both engines render
 * these strings: Next renders a client component on the server first and hydrates it in the
 * browser. Two ICUs disagreeing by one space is a hydration mismatch on precisely the
 * surfaces this issue is about. So `az` is ours everywhere, and `az-formats.test.ts` asserts
 * ours is byte-for-byte what full ICU produces — a test that can only run where the data
 * exists, and does, because vitest runs on Node.
 *
 * <p><strong>Not a polyfill</strong> — `@formatjs/intl-datetimeformat` with `az` data is
 * correct and is tens of kilobytes on every route that prints a date, which is most of them.
 * `docs/performance.md`'s budgets are a hard CI gate and a route that drops under one fails
 * as loudly as a route that exceeds it. What is actually needed is six relative-time units
 * and the month and weekday names.
 *
 * <h2>The numbers come from `en-GB`, which is not a shortcut</h2>
 *
 * <p>Everything about an Azerbaijani date that is not a word is identical to a British one:
 * day before month, a 24-hour clock, `GMT+4`, `09:06` padded the same way, the same handling
 * of a named time zone and of an instant near a transition. Reimplementing that would be
 * reimplementing a calendar. So `en-GB` renders the numeric fields, this module supplies the
 * words and the order, and `INTL_LOCALE` maps English to `en-GB` for exactly the same
 * reason — `formats.ts` has that argument at length.
 */

/**
 * The months, as CLDR spells them.
 *
 * <p>`narrow` is the ordinal, which is what Azerbaijani narrow months are; a table that
 * invented letters for them would be inventing a language.
 */
const MONTHS: Readonly<Record<'long' | 'short' | 'narrow', readonly string[]>> = {
  long: [
    'yanvar',
    'fevral',
    'mart',
    'aprel',
    'may',
    'iyun',
    'iyul',
    'avqust',
    'sentyabr',
    'oktyabr',
    'noyabr',
    'dekabr',
  ],
  short: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'],
  narrow: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
};

/** The weekdays, Sunday first, because that is what `Date.prototype.getUTCDay` counts from. */
const WEEKDAYS: Readonly<Record<'long' | 'short' | 'narrow', readonly string[]>> = {
  long: [
    'bazar',
    'bazar ertəsi',
    'çərşənbə axşamı',
    'çərşənbə',
    'cümə axşamı',
    'cümə',
    'şənbə',
  ],
  short: ['B.', 'B.E.', 'Ç.A.', 'Ç.', 'C.A.', 'C.', 'Ş.'],
  narrow: ['7', '1', '2', '3', '4', '5', '6'],
};

/** What a unit is called in the two directions, when the count is spelled out. */
const RELATIVE_UNITS: Readonly<Record<string, string>> = {
  second: 'saniyə',
  minute: 'dəqiqə',
  hour: 'saat',
  day: 'gün',
  week: 'həftə',
  month: 'ay',
  quarter: 'rüb',
  year: 'il',
};

/**
 * The counts a language has a word for instead of a number — CLDR's `relative-type` fields.
 *
 * <p>This is the whole of what `numeric: 'auto'` means, and it is why the queue reads
 * "keçən həftə" rather than "1 həftə öncə". A table missing a row here is not wrong, only
 * stilted; a table with a wrong row says the wrong day.
 */
const RELATIVE_NAMED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  second: { '0': 'indi' },
  minute: { '0': 'bu dəqiqə' },
  hour: { '0': 'bu saat' },
  day: { '-1': 'dünən', '0': 'bu gün', '1': 'sabah' },
  week: { '-1': 'keçən həftə', '0': 'bu həftə', '1': 'gələn həftə' },
  month: { '-1': 'keçən ay', '0': 'bu ay', '1': 'gələn ay' },
  quarter: { '-1': 'keçən rüb', '0': 'bu rüb', '1': 'gələn rüb' },
  year: { '-1': 'keçən il', '0': 'bu il', '1': 'gələn il' },
};

/** What this module can answer with. The `Intl` constructors' one method, and only it. */
export interface AzerbaijaniDateTimeFormat {
  format(value: Date | number): string;
}

export interface AzerbaijaniRelativeTimeFormat {
  format(value: number, unit: Intl.RelativeTimeFormatUnit): string;
}

export interface AzerbaijaniNumberFormat {
  format(value: number): string;
}

/**
 * `1.234,5`, `2,9%` — issue #403.
 *
 * <p>The same defect one type over: Chromium's `az` groups with a comma and points with a
 * dot, which is the root locale, so `/admin/fees` rendered a generated `2.9%` beside a
 * hand-written `2,9%` in the note next to it and the generated half was the wrong one.
 *
 * <p>Azerbaijani groups with a dot and points with a comma, which is `en-GB` with the two
 * swapped and nothing else moved: the rounding, the digit count, the percent sign's position
 * — after the number in both — and the minus sign are already right. Doing it this way rather
 * than substituting a surrogate locale wholesale is what keeps the currency and percent
 * options behaving as the caller asked.
 */
export function azerbaijaniNumberFormat(options: Intl.NumberFormatOptions): AzerbaijaniNumberFormat {
  const rendered = new Intl.NumberFormat('en-GB', options);

  return {
    format(value: number): string {
      let written = '';
      for (const part of rendered.formatToParts(value)) {
        if (part.type === 'group') written += '.';
        else if (part.type === 'decimal') written += ',';
        else written += part.value;
      }
      return written;
    },
  };
}

/** `week`, `weeks` and `week` again — `Intl` accepts a plural and this table is keyed singular. */
function singular(unit: Intl.RelativeTimeFormatUnit): string {
  return unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

/**
 * "3 həftə öncə", "keçən həftə", "sabah".
 *
 * <p>`numeric: 'always'` skips the named counts, exactly as `Intl` does, so a caller that
 * wants "1 gün öncə" rather than "dünən" asks for it the same way.
 */
export function azerbaijaniRelativeTimeFormat(
  options: Intl.RelativeTimeFormatOptions,
): AzerbaijaniRelativeTimeFormat {
  const named = options.numeric !== 'always';

  return {
    format(value: number, unit: Intl.RelativeTimeFormatUnit): string {
      const key = singular(unit);
      const rounded = Object.is(value, -0) ? 0 : value;

      if (named) {
        const word = RELATIVE_NAMED[key]?.[String(rounded)];
        if (word !== undefined) return word;
      }

      const noun = RELATIVE_UNITS[key];
      if (noun === undefined) return String(rounded);

      // Azerbaijani takes one form after a number — "3 həftə", not "3 həftələr" — so there is
      // no plural rule to apply, and the sign carries the direction rather than the figure.
      const count = Math.abs(rounded);
      return rounded < 0 ? `${count} ${noun} öncə` : `${count} ${noun} ərzində`;
    },
  };
}

/** Which width of month a set of options asks for, in `Intl`'s own vocabulary. */
function monthStyle(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions['month'] {
  if (options.month !== undefined) return options.month;
  if (options.dateStyle === 'full' || options.dateStyle === 'long') return 'long';
  if (options.dateStyle === 'medium') return 'short';
  if (options.dateStyle === 'short') return '2-digit';
  return undefined;
}

/** The same for the weekday, which only `dateStyle: 'full'` asks for on its own. */
function weekdayStyle(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions['weekday'] {
  if (options.weekday !== undefined) return options.weekday;
  return options.dateStyle === 'full' ? 'long' : undefined;
}

/** What `en-GB` rendered, by field. Literals are dropped: the order here is this module's. */
function fieldsOf(formatter: Intl.DateTimeFormat, at: Date): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== 'literal') fields[part.type] = part.value;
  }
  return fields;
}

/**
 * An Azerbaijani date and time formatter for one set of options.
 *
 * <p>Two formatters behind it, and both are doing work. The first renders the requested
 * options in `en-GB`, which supplies every numeric field already padded, zoned and correct
 * across a daylight transition. The second reads the calendar date in the same zone as plain
 * numbers, because the month index cannot be recovered from a month *name* without matching
 * English words — and `en-GB` has spelled September "Sept" since CLDR 42, which is the kind
 * of thing that changes underneath a lookup table.
 */
export function azerbaijaniDateTimeFormat(
  options: Intl.DateTimeFormatOptions,
): AzerbaijaniDateTimeFormat {
  const rendered = new Intl.DateTimeFormat('en-GB', options);
  const calendar = new Intl.DateTimeFormat('en-GB', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const month = monthStyle(options);
  const weekday = weekdayStyle(options);
  const spelledOut = month === 'long' || month === 'short' || month === 'narrow';

  return {
    format(value: Date | number): string {
      const at = typeof value === 'number' ? new Date(value) : value;
      const fields = fieldsOf(rendered, at);
      const date = fieldsOf(calendar, at);

      const monthIndex = Number(date.month) - 1;
      // Built in UTC from the zoned calendar date, so the weekday is the one the reader is
      // looking at rather than the one it is in Greenwich.
      const dayIndex = new Date(
        Date.UTC(Number(date.year), monthIndex, Number(date.day)),
      ).getUTCDay();

      let written = '';

      if (fields.month !== undefined && spelledOut) {
        // `14 avqust 2026` — day, month, year, in that order and separated by spaces. The
        // month falls back to whatever `en-GB` rendered if the index is somehow outside the
        // table, which is a January-to-December array and cannot be, but `strict` counts.
        const name = MONTHS[month as 'long' | 'short' | 'narrow'][monthIndex] ?? fields.month;
        written = [fields.day, name, fields.year]
          .filter((piece) => piece !== undefined && piece !== '')
          .join(' ');
      } else if (fields.month !== undefined) {
        // `14.08.2026`. A two-digit year is what `dateStyle: 'short'` means here, and `en-GB`
        // renders four for it, so this is the one numeric field that cannot come from it.
        const year =
          options.dateStyle === 'short' && fields.year !== undefined
            ? fields.year.slice(-2)
            : fields.year;
        written = [fields.day, fields.month, year]
          .filter((piece) => piece !== undefined && piece !== '')
          .join('.');
      } else {
        written = [fields.day, fields.year]
          .filter((piece) => piece !== undefined && piece !== '')
          .join(' ');
      }

      if (weekday !== undefined && fields.weekday !== undefined) {
        const name = WEEKDAYS[weekday as 'long' | 'short' | 'narrow'][dayIndex] ?? fields.weekday;
        // After the date and not before it. `14 avqust 2026, cümə`.
        written = written === '' ? name : `${written}, ${name}`;
      }

      const clock = [fields.hour, fields.minute, fields.second]
        .filter((piece) => piece !== undefined)
        .join(':');
      const time = [clock, fields.timeZoneName].filter((piece) => piece !== undefined && piece !== '').join(' ');

      if (written === '') return time;
      if (time === '') return written;

      /*
       * The glue, which is a field of its own in CLDR and differs by the length of the date:
       * a full or long date takes `{1}/{0}` and a medium or short one takes `{1}, {0}`. So
       * `14 avq 2026, 23:06` and `14 avqust 2026/23:06` are both correct, and both are what
       * full ICU produces. It reads oddly in English and it is not this module's to reword.
       */
      return `${written}${spelledOut && month === 'long' ? '/' : ', '}${time}`;
    },
  };
}
