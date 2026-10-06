import type { Money } from '@ideanest/money';

/**
 * `GET /v1/users/{slug}` and its two lists, narrowed once — the web's `lib/profiles/wire.ts`
 * (#156).
 *
 * <p>Every refusal is one answer: the service sends 404 alike for an unknown slug, a closed account
 * and a private profile, and a body this module cannot read is `null` — the same not-found screen,
 * never "this profile is private".
 *
 * <p>Unlike the web, an address that is not `https://` is kept rather than dropped: the About tab
 * prints it as text and never opens it (#156: "anything else is not a link").
 */

/** One page of either list — the web's `PROFILE_PAGE_SIZE`. */
export const PROFILE_PAGE_SIZE = 24;

export interface ProfileSocialLink {
  readonly platform: string;
  readonly url: string;
}

export interface ProfileLocation {
  readonly slug: string;
  readonly name: string;
}

export interface PublicProfile {
  readonly slug: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Plain text; `null` is somebody who has written none. */
  readonly bio: string | null;
  /** ISO-8601 instant, or `null` — never "January 1970". */
  readonly joinedAt: string | null;
  readonly websiteUrl: string | null;
  readonly location: ProfileLocation | null;
  readonly socialLinks: readonly ProfileSocialLink[];
}

/** One campaign on either list. `goal` and `pledged` never arrive on the Backed list. */
export interface ProfileProjectCard {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly creatorSlug: string;
  readonly blurb: string | null;
  /** Open: a state this build has no word for is drawn as itself. */
  readonly state: string;
  readonly goal: Money | null;
  readonly pledged: Money | null;
  readonly backersCount: number;
  readonly coverUrl: string | null;
}

export interface ProfilePage {
  readonly items: readonly ProfileProjectCard[];
  readonly nextCursor: string | null;
}

/** A profile, or `null` for every unreadable body alike. */
export function readPublicProfile(value: unknown): PublicProfile | null {
  const source = object(value);
  if (source === null) return null;
  const slug = text(source['slug']);
  const name = text(source['name']);
  if (slug === null || name === null) return null;
  return {
    slug,
    name,
    avatarUrl: text(source['avatarUrl']),
    bio: text(source['bio']),
    joinedAt: text(source['joinedAt']),
    websiteUrl: text(source['websiteUrl']),
    location: readLocation(source['location']),
    socialLinks: readSocialLinks(source['socialLinks']),
  };
}

/** One page of cards. A row missing any of the five fields that make a link is dropped. */
export function readProjectCardPage(value: unknown): ProfilePage {
  const source = object(value);
  if (source === null) return { items: [], nextCursor: null };
  const rows = source['projects'];
  const items: ProfileProjectCard[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows as readonly unknown[]) {
      const card = readProjectCard(row);
      if (card !== null) items.push(card);
    }
  }
  return { items, nextCursor: text(source['nextCursor']) };
}

/** Whether an address may be opened: `https:` and nothing else. */
export function isHttps(url: string): boolean {
  return /^https:\/\/\S+$/i.test(url);
}

function readProjectCard(value: unknown): ProfileProjectCard | null {
  const source = object(value);
  if (source === null) return null;
  const id = text(source['id']);
  const title = text(source['title']);
  const slug = text(source['slug']);
  const creatorSlug = text(source['creatorSlug']);
  const state = text(source['state']);
  if (id === null || title === null || slug === null || creatorSlug === null || state === null) {
    return null;
  }
  return {
    id,
    title,
    slug,
    creatorSlug,
    blurb: text(source['blurb']),
    state,
    goal: money(source['goal']),
    pledged: money(source['pledged']),
    backersCount: count(source['backersCount']),
    coverUrl: text(object(source['coverImage'])?.['url']),
  };
}

function readLocation(value: unknown): ProfileLocation | null {
  const source = object(value);
  if (source === null) return null;
  const slug = text(source['slug']);
  const name = text(source['name']);
  return slug === null || name === null ? null : { slug, name };
}

function readSocialLinks(value: unknown): readonly ProfileSocialLink[] {
  if (!Array.isArray(value)) return [];
  const links: ProfileSocialLink[] = [];
  for (const row of value as readonly unknown[]) {
    const source = object(row);
    const platform = text(source?.['platform']);
    const url = text(source?.['url']);
    if (platform !== null && url !== null) links.push({ platform, url });
  }
  return links;
}

/** The amount stays the string it arrived as (CLAUDE.md: money is never a number). */
function money(value: unknown): Money | null {
  const source = object(value);
  if (source === null) return null;
  const { amount, currency } = source;
  return typeof amount === 'string' && typeof currency === 'string' ? { amount, currency } : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
