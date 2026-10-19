import type { Page } from '../community/signals';
import type { Money } from '../money';
import type { CardVideo } from '@ideanest/discovery/card-media';
import type {
  CoverImage,
  ProfileLocation,
  ProfileProjectCard,
  ProfileSocialLink,
  PublicProfile,
} from './api';

/**
 * `GET /v1/users/{slug}` and its two lists, narrowed once — issue #323.
 *
 * <h2>Why this module exists</h2>
 *
 * Two readers of the same endpoint were written in parallel during #321 and both merged:
 * `lib/profiles/server.ts`, which cast the body, and `lib/projects/creatorProfile.ts`, which
 * narrowed it field by field with a test. Both were correct and neither was the whole answer.
 * The cast is the half that is wrong — `lib/projects/publicPage.ts` sets out why at length —
 * and the field-by-field reader is the half that would have been lost by deleting the file
 * that looked like the duplicate. So the narrowing moved here, and both surfaces read through
 * it.
 *
 * <h2>What the cast actually cost</h2>
 *
 * Not a hypothetical. `PublicProfile.joinedAt` was typed `string` because the projection
 * always sends one, and `ProfileAbout` handed it straight to `new Date(...)`. A body without
 * the field — a service one release behind, a proxy that dropped it, a shape that was not the
 * JSON it claimed to be — puts `Invalid Date` on one profile and, for an explicit `null`,
 * **January 1970** on another. The second is the dangerous one: a confident sentence about a
 * stranger, assembled out of a field nobody sent. The type is `string | null` now, and this
 * module is what makes that true rather than merely declared.
 *
 * <h2>Every refusal is still one answer</h2>
 *
 * Nothing here inspects a status. The service answers 404 for an unknown slug, a closed
 * account and a `PRIVATE` one alike, so that a client cannot be used to tell them apart, and a
 * narrowing that reported *why* a body was unusable would rebuild that oracle one layer up. A
 * body this module cannot read is `null`, the same as a body that never arrived.
 *
 * <h2>Absent is not empty, and a dropped row is not a blank row</h2>
 *
 * A profile with no `slug` or no `name` is `null` rather than a profile with holes in it:
 * there is nothing to address it by and nothing to introduce it as. A campaign card missing
 * any of the five fields that make a link is dropped rather than rendered as an unlabelled
 * hole in somebody's body of work. Everything else stays optional, because "they have not
 * written a biography" and "the field did not arrive" both reach a reader as nothing, and only
 * one of them is worth a box on screen.
 */

/** A profile, or `null` for every refusal and every unreadable body alike. */
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

/**
 * One page of campaign cards.
 *
 * A `Page` and never `null`: a body that cannot be read is an empty page with no cursor, which
 * is what a list renders as. The caller that needs "the service refused" as a different thing
 * from "there is nothing here" — `lib/profiles/server.ts` does, so that a restarting service
 * cannot print "no campaigns yet" — keeps that distinction at the fetch, where the status is.
 */
export function readProjectCardPage(value: unknown): Page<ProfileProjectCard> {
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

function readProjectCard(value: unknown): ProfileProjectCard | null {
  const source = object(value);
  if (source === null) return null;

  const id = text(source['id']);
  const title = text(source['title']);
  const slug = text(source['slug']);
  const creatorSlug = text(source['creatorSlug']);
  const state = text(source['state']);
  // Without all five there is no link to make and nothing to call it, which is a row that
  // would render as an unlabelled hole in a list of somebody's work.
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
    backersCount: count(source['backersCount']) ?? 0,
    deadline: text(source['deadline']),
    launchedAt: text(source['launchedAt']),
    coverImage: readCoverImage(source['coverImage']),
    video: readCardVideo(source['video']),
  };
}

/** The card's video, or `null` when any of the four fields a preview needs is missing. */
function readCardVideo(value: unknown): CardVideo | null {
  const source = object(value);
  if (source === null) return null;

  const url = text(source['url']);
  const posterUrl = text(source['posterUrl']);
  const { width, height } = source;
  if (url === null || posterUrl === null || typeof width !== 'number' || typeof height !== 'number') {
    return null;
  }
  if (width <= 0 || height <= 0) return null;

  return { url, posterUrl, width, height };
}

function readCoverImage(value: unknown): CoverImage | null {
  const source = object(value);
  if (source === null) return null;

  const url = text(source['url']);
  const { width, height } = source;
  // The three columns are written together or not at all, and the dimensions are what let a
  // card reserve its box before the photograph decodes.
  if (url === null || typeof width !== 'number' || typeof height !== 'number') return null;
  if (width <= 0 || height <= 0) return null;

  return { url, width, height };
}

function readLocation(value: unknown): ProfileLocation | null {
  const source = object(value);
  if (source === null) return null;

  const slug = text(source['slug']);
  const name = text(source['name']);
  // A place with a slug and no name has nothing to print; a name with no slug has nowhere to
  // go. Neither half on its own is a location.
  return slug === null || name === null ? null : { slug, name };
}

/**
 * The accounts elsewhere their owner listed, in their order.
 *
 * An empty array for anything unreadable, because `PublicProfileResponse` promises an array
 * and a client that met a `null` here would be a client that crashed against a service one
 * release older than itself.
 *
 * **`https://` only, checked again rather than trusted.** The service refuses everything else
 * on the way in. This refuses it once more on the way out, because being wrong about that
 * exactly once means a `javascript:` address rendered as an anchor on a page a stranger wrote
 * and a search engine indexes.
 */
function readSocialLinks(value: unknown): readonly ProfileSocialLink[] {
  if (!Array.isArray(value)) return [];

  const links: ProfileSocialLink[] = [];
  for (const row of value as readonly unknown[]) {
    const source = object(row);
    if (source === null) continue;

    const platform = text(source['platform']);
    const url = text(source['url']);
    if (platform === null || url === null) continue;
    if (!url.toLowerCase().startsWith('https://')) continue;

    links.push({ platform, url });
  }
  return links;
}

/**
 * `{"amount": "599.00", "currency": "AZN"}`, or null.
 *
 * The amount stays the string it arrived as. CLAUDE.md §3: money never becomes a number on the
 * way in, because a number is where the precision goes.
 */
function money(value: unknown): Money | null {
  const source = object(value);
  if (source === null) return null;

  const amount = source['amount'];
  const currency = source['currency'];
  if (typeof amount !== 'string' || typeof currency !== 'string') return null;

  return { amount, currency };
}

/**
 * A non-negative whole number, or `null`.
 *
 * `null` rather than zero for an absent count. "0 backers" and "the service did not say" are
 * different statements, and the caller decides which of them it is entitled to print.
 */
function count(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** An object that is neither an array nor null, or `null`. */
function object(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
