import { createElement, Fragment, type ReactNode } from 'react';
import { dateTimeFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';
import { apiOrigin } from '../seo/metadata-source';
import { momentOf, PLATFORM_TIME_ZONE, type Moment } from './script';
import { readPlatformStatus, STATUS_PATH, type PlatformStatus } from './status';

/**
 * The server's half of the maintenance notice and page — #214.
 *
 * Kept apart from `script.ts` so that nothing a browser runs imports the catalogue's
 * formatters, and apart from `gate.ts` because the proxy never renders anything.
 */

/**
 * `GET /v1/status` for a render.
 *
 * `SiteShell` asks on every public render, so it reads through Next's data cache for thirty
 * seconds: an announcement is a day's notice, and the window itself is closed by the proxy,
 * not by this. The maintenance page and the console ask with `no-store`, because what they
 * say is about now.
 */
export function readStatusForRender(fresh: boolean): Promise<PlatformStatus | null> {
  return readPlatformStatus(
    `${apiOrigin()}${STATUS_PATH}`,
    fresh ? { cache: 'no-store' } : { next: { revalidate: 30 } },
  );
}

/**
 * A template per month, `{d}` where the day goes, in the reader's language.
 *
 * Written from the day-and-month the language itself produces, so the order and the case are
 * the language's: `{d} October`, `{d} oktyabr`, `{d} октября` — genitive, as Russian has it
 * after a number. The fifteenth, because it is two digits in every calendar and appears in no
 * month name.
 */
export function monthTemplates(locale: Locale): string[] {
  const format = dateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }, 'maintenance-month');
  const months: string[] = [];
  for (let month = 0; month < 12; month += 1) {
    months.push(format.format(new Date(Date.UTC(2026, month, 15))).replace('15', '{d}'));
  }
  return months;
}

/** An instant in the platform's zone, as the server writes it before the reader's is known. */
export function platformMoment(instant: string, months: readonly string[]): Moment | null {
  return momentOf(instant, PLATFORM_TIME_ZONE, months);
}

/**
 * A catalogue template with its `{placeholders}` replaced by nodes.
 *
 * `fillPlaceholders` fills strings. A notice fills its placeholders with `<time>` elements,
 * which the script rewrites in the reader's zone, so the sentence has to become nodes — in the
 * language's own order, which is why it is split rather than assembled.
 */
export function interpolate(template: string, values: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return template.split(/(\{[a-zA-Z]+\})/).map((piece, index) => {
    const name = /^\{([a-zA-Z]+)\}$/.exec(piece)?.[1];
    return createElement(Fragment, { key: index }, name !== undefined && name in values ? values[name] : piece);
  });
}
