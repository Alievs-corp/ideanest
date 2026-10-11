/**
 * The vocabulary a cached public read is filed under, and the only place it is spelled —
 * issue #127.
 *
 * <h2>Why tags at all, when every read already has a window</h2>
 *
 * Every public read in this application carries `next: { revalidate: 60 }`, and that alone is
 * a caching strategy: a page is at most a minute stale and the load on the service is bounded
 * whatever the traffic. What it is not is *invalidation*. A backer who pledges watches the
 * total they just moved sit unchanged for up to a minute, on the one page where the number is
 * the whole point — and a creator who publishes an update sends people to a page that does not
 * have it yet.
 *
 * Shortening the window is the wrong answer to both. It costs every reader of every campaign a
 * request to make the one campaign that changed correct sooner, and it still does not make it
 * correct *now*. A tag lets the service say which campaign moved, so the minute stays for
 * everything nobody touched.
 *
 * <h2>The shape of a tag</h2>
 *
 * `{kind}:{identifier}`, or a bare word for the handful of reads that are about the platform
 * rather than about one thing in it. Two kinds address a campaign and both are needed, because
 * the two sides of this know different names for it:
 *
 * <ul>
 *   <li>{@link campaignAddress} — `campaign:{creatorSlug}/{projectSlug}`. The campaign page is
 *       read by its public address, before anything knows the identifier behind it, so this is
 *       the only tag that read can carry.
 *   <li>{@link project} — `project:{id}`. Everything hanging off a campaign — its rewards, its
 *       updates, its comments, its questions — is read by identifier, and an event from the
 *       service carries the identifier and never the address.
 * </ul>
 *
 * The service therefore sends both when a campaign changes; `ProjectCacheTags` on the API side
 * is where it composes them, and this module is what that one has to agree with.
 *
 * <h2>WHAT IS DELIBERATELY NOT INVALIDATED ON A PLEDGE</h2>
 *
 * The discovery feed. A pledge changes the amount raised, which changes the ordering of a feed
 * sorted by momentum — so on paper every pledge on the platform invalidates every feed page.
 * That is a cache that is empty at any interesting traffic level, in exchange for a reader
 * seeing a slightly older ordering of campaigns they have not chosen yet. The feed keeps its
 * minute, and {@link DISCOVERY} exists for the events that genuinely change what is *in* it —
 * a campaign launching, a campaign closing — which happen at human rather than transactional
 * frequency.
 */

/** Everything the discovery feed and the search page read. */
export const DISCOVERY = 'discovery';

/** The category tree. Edited by staff, read by every browse page. */
export const TAXONOMY = 'taxonomy';

/** The curated collections index. One tag, because the index is one document. */
export const COLLECTIONS = 'collections';

/**
 * The subscription plans a creator publishes under. One tag: the catalogue is one document.
 *
 * <p>Deliberately long-lived beside the others. A price changes a handful of times a year and
 * is changed by one screen, so the pricing page takes the taxonomy's window rather than the
 * shared minute -- and this tag is what makes that survivable, because an operator who
 * repriced a plan should not spend an hour being told the browser is broken.
 */
export const PLANS = 'plans';

/**
 * §22.2's legal documents. One tag: publishing a version changes the whole set at once.
 *
 * <p>Long-lived beside the others, for {@link PLANS}' reason and more strongly. These change
 * a few times a year, they are the same document for every reader in a language, and they are
 * written by exactly one screen. The tag is what makes the long window survivable in the one
 * direction that matters: a version published this morning must be the one somebody accepting
 * this afternoon is shown, and an administrator who published it should not spend an hour
 * being told the site is stale.
 */
export const LEGAL = 'legal';

/** One campaign, by the identifier the service knows it as. */
export function project(id: string): string {
  return `project:${id}`;
}

/**
 * One campaign, by the address a reader asks for it at.
 *
 * Both slugs, because neither is unique on its own: two creators may each have a campaign
 * called `studio`, and one creator may rename a campaign without the old address becoming
 * somebody else's.
 */
export function campaignAddress(creatorSlug: string, projectSlug: string): string {
  return `campaign:${creatorSlug}/${projectSlug}`;
}

/** One curated collection's landing page. */
export function collection(slug: string): string {
  return `collection:${slug}`;
}

/** One person's public profile and the two lists on it. */
export function profile(slug: string): string {
  return `profile:${slug}`;
}

/**
 * Whether a string is shaped like a tag this application would have written.
 *
 * <h2>This is a guard on an endpoint, not a formality</h2>
 *
 * `/api/cache/revalidate` takes tags from the service, and a tag is a key into a cache that
 * serves every reader. The endpoint is authenticated, so the question is not whether a
 * stranger can call it — it is what a caller with the secret and a bug can do by accident.
 * An empty string, a wildcard, or a tag built out of an unescaped campaign title are all
 * plausible mistakes, and the first two evict everything.
 *
 * So the vocabulary is closed: one of the four bare words, or a known prefix followed by a
 * plausible identifier. Anything else is refused and named in the response, because a
 * caller whose tag was silently ignored would believe the cache was cleared.
 */
export function isCacheTag(value: string): boolean {
  if (value === DISCOVERY || value === TAXONOMY || value === COLLECTIONS || value === LEGAL) {
    return true;
  }

  const separator = value.indexOf(':');
  if (separator <= 0) return false;

  const kind = value.slice(0, separator);
  const identifier = value.slice(separator + 1);
  if (identifier === '' || identifier.length > MAX_IDENTIFIER_LENGTH) return false;

  switch (kind) {
    case 'project':
    case 'collection':
    case 'profile':
      return SLUG.test(identifier);
    // The only tag with two parts, and the slash is what separates them rather than a
    // character an identifier may contain.
    case 'campaign': {
      const parts = identifier.split('/');
      return parts.length === 2 && parts.every((part) => part !== '' && SLUG.test(part));
    }
    default:
      return false;
  }
}

/**
 * Long enough for a UUID and for §10.2's slugs, short enough that a tag cannot be a payload.
 * The service's own slug column is 120.
 */
const MAX_IDENTIFIER_LENGTH = 120;

/** What the service's identifiers and slugs are made of, and nothing else. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/u;
