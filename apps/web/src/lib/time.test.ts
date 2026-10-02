import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './i18n/locale';
import { formatExactTime, formatRelativeTime } from './time';

/*
 * Moved from `lib/sessions/describe.test.ts` when the device-naming half of that module went to
 * `@ideanest/account/sessions` (#161). The time formatting stayed here, where it already lived.
 */

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('does not pretend to second-level precision', () => {
    expect(formatRelativeTime('2026-08-15T11:59:40.000Z', now, 'en')).toBe('now');
    expect(formatRelativeTime('2026-08-15T12:00:00.000Z', now, 'en')).toBe('now');
  });

  it('steps up through the units', () => {
    expect(formatRelativeTime('2026-08-15T11:55:00.000Z', now, 'en')).toBe('5 minutes ago');
    expect(formatRelativeTime('2026-08-15T09:00:00.000Z', now, 'en')).toBe('3 hours ago');
    expect(formatRelativeTime('2026-08-14T12:00:00.000Z', now, 'en')).toBe('yesterday');
    expect(formatRelativeTime('2026-08-11T12:00:00.000Z', now, 'en')).toBe('4 days ago');
    expect(formatRelativeTime('2026-06-15T12:00:00.000Z', now, 'en')).toBe('2 months ago');
  });

  // `expiresAt` is in the future, and the same formatter renders it.
  it('handles an instant that has not happened yet', () => {
    expect(formatRelativeTime('2026-08-16T12:00:00.000Z', now, 'en')).toBe('tomorrow');
  });

  it('says so rather than rendering "Invalid Date"', () => {
    expect(formatRelativeTime('not-a-date', now, 'en')).toBe('Unknown');
  });

  /**
   * #324. These strings are the only record on screen of when something happened, and until
   * #123 landed a reader in Azerbaijani got every one of them in English. The pin is gone and
   * this is what proves it: the same instant, four languages, four different sentences.
   */
  it('writes the same instant in each of the four languages', () => {
    const rendered = SUPPORTED_LOCALES.map((locale) =>
      formatRelativeTime('2026-08-15T09:00:00.000Z', now, locale),
    );

    expect(rendered).toEqual(['3 saat öncə', '3 hours ago', '3 часа назад', '3 saat önce']);
  });

  it('takes the language’s own word for the present moment rather than a translated one', () => {
    const rendered = SUPPORTED_LOCALES.map((locale) =>
      formatRelativeTime('2026-08-15T12:00:00.000Z', now, locale),
    );

    expect(rendered).toEqual(['indi', 'now', 'сейчас', 'şimdi']);
  });
});

describe('formatExactTime', () => {
  it('renders a real instant', () => {
    expect(formatExactTime('2026-08-15T12:00:00.000Z', 'en')).toContain('2026');
  });

  it('says so rather than rendering "Invalid Date"', () => {
    expect(formatExactTime('', 'en')).toBe('Unknown');
  });

  /**
   * English is `en-GB` and not `en` — see `packages/messages/src/formats.ts`. A bare `en` resolves
   * to `en-US` inside `Intl`, which would put a twelve-hour clock and a month-first date on the
   * one language out of four that does not use them.
   */
  it('keeps the English reader on the same clock as everybody else', () => {
    // The hour depends on the machine's zone, so only the shape is asserted: two digits and
    // no meridiem. `Mar 14, 2026, 2:05 PM` is what a bare `en` would have produced.
    const at = formatExactTime('2026-03-14T14:05:00.000Z', 'en');

    expect(at).toMatch(/\d{2}:05/u);
    expect(at).not.toMatch(/AM|PM/u);
  });
});
