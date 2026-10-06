import Decimal from 'decimal.js';
import type { Locale } from '@ideanest/messages';
import { dateTimeFormat } from '@ideanest/messages/formats';
import {
  formatToPartsWorks,
  partlessAzerbaijaniDateTimeFormat,
} from '@ideanest/messages/hermes';
import type { ProfilePage } from './wire';

/**
 * The profile's small rules (#156), each the web's: the completion figure, the tab count that is
 * only ever a known total, the platform names and the joined month.
 */

/**
 * `pledged / goal × 100` as a decimal, or `null` — no goal, a goal of zero or less, or a malformed
 * figure. A percentage of nothing is not "0% funded".
 */
export function completionOf(goal: string, pledged: string): Decimal | null {
  try {
    const target = new Decimal(goal);
    if (!target.isFinite() || target.lessThanOrEqualTo(0)) return null;
    const value = new Decimal(pledged).dividedBy(target).times(100);
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}

/**
 * The count beside a tab: the length of the first page **only when it has no next cursor**, the
 * one time the total is known. A paged list or a list that failed has none — never the size of
 * the first page dressed up as a total.
 */
export function knownTotal(first: ProfilePage | undefined): number | undefined {
  if (first === undefined || first.nextCursor !== null) return undefined;
  return first.items.length;
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  X: 'X',
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  LINKEDIN: 'LinkedIn',
  TELEGRAM: 'Telegram',
  GITHUB: 'GitHub',
  BEHANCE: 'Behance',
};

/**
 * The web's `socialPlatformLabel`: brand names, the same in every language, and the stored value
 * itself for a platform this build does not know.
 */
export function socialPlatformLabel(platform: string): string {
  return Object.hasOwn(PLATFORM_LABELS, platform) ? (PLATFORM_LABELS[platform] ?? platform) : platform;
}

const MONTH_OPTIONS: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const PARTS = formatToPartsWorks();
let partlessMonth: ReturnType<typeof partlessAzerbaijaniDateTimeFormat> | undefined;

/** "March 2025" in the app's language, or `null` for an absent or unparseable instant. */
export function joinedMonth(iso: string | null, locale: Locale): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    const format =
      locale !== 'az' || PARTS.dates
        ? dateTimeFormat(locale, MONTH_OPTIONS, 'joined-month')
        : (partlessMonth ??= partlessAzerbaijaniDateTimeFormat(MONTH_OPTIONS));
    return format.format(at) || null;
  } catch {
    return null;
  }
}
