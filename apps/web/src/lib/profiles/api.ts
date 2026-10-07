import { authorizedFetch, publicFetch } from '../api/client';
import { ApiError, errorFrom } from '../api/problem';
import type { Page } from '../community/signals';
import type { Money } from '../money';
import { readProjectCardPage } from './wire';

/**
 * §4.2's public profile — P-04, P-05, P-06 and P-07, issue #274.
 *
 * <h2>One module for four endpoints, because they are one page</h2>
 *
 * `GET /v1/users/{slug}`, its two lists, and the single write that decides whether any of
 * them answer at all. `lib/community/signals.ts` states the rule this follows — a screen's
 * data and its paginator belong together — and the alternative here is worse than usual: the
 * three reads share the 404 contract below, and a second module that read one of them would
 * be a second place for "private is indistinguishable from absent" to be got wrong.
 *
 * <h2>404 is the whole design, and the client must not decorate it</h2>
 *
 * The service answers **404** for an unknown slug, for a closed account, and for an account
 * whose `profile_visibility` is `PRIVATE`. Three different facts, one answer, deliberately:
 * a 403 would confirm that the person exists and has chosen to hide, which is precisely the
 * thing P-07 is for. So nothing in this module distinguishes them, nothing renders "this
 * profile is private", and the page renders the ordinary not-found route for all three.
 *
 * A client that tried to be helpful here — "that account is private" — would be an oracle
 * built on top of an endpoint designed not to be one, and it would leak the fact from the
 * browser rather than from the service, which is not an improvement.
 *
 * <h2>`publicFetch`, not `authorizedFetch`, for the reads</h2>
 *
 * All three are `permitAll` and a profile is what a signed-out visitor follows from a
 * campaign page. `authorizedFetch` throws when there is no token, which would turn "look at
 * who made this" into "sign in first". The one write is the caller's own account and takes
 * `authorizedFetch`.
 *
 * <h2>Money is on the created list and never on the backed one</h2>
 *
 * `ProfileProjectCard` carries `goal` and `pledged` because a creator's own campaigns are
 * public figures — the same numbers the discovery card shows. **P-04 says the backed archive
 * carries no amounts**, and the service omits them there rather than sending zeroes. Both
 * lists are the same type because they are the same rows from the same table; what differs
 * is what the service is willing to say about them, and `components/profile/ProfileCampaignCard`
 * is where that difference is enforced on screen. See its doc comment before "improving" it.
 */

/** §4.2 P-07. `PUBLIC` is the column default and what every account starts as. */
export type ProfileVisibility = 'PUBLIC' | 'PRIVATE';

/**
 * §4.2 P-03's nine platforms — `az.ideanest.user.domain.SocialPlatform`, spelled exactly.
 *
 * A **closed** list on both sides. The request body binds straight to the enum, so a name
 * this array got wrong is a 400 from Jackson before any handler runs rather than a link that
 * quietly fails to save. `X` is stored under its current name and is not a second platform
 * from `TWITTER`; the enum's own comment says so.
 *
 * The labels are here and not on the service because they are interface text: the service
 * stores an identifier and this is the word a person reads beside a `<select>`.
 */
export const SOCIAL_PLATFORMS = [
  'INSTAGRAM',
  'FACEBOOK',
  'X',
  'YOUTUBE',
  'TIKTOK',
  'LINKEDIN',
  'TELEGRAM',
  'GITHUB',
  'BEHANCE',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const SOCIAL_PLATFORM_LABELS: Readonly<Record<SocialPlatform, string>> = {
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
 * The word a reader sees for a platform.
 *
 * Falls back to the stored identifier rather than to nothing, so a tenth platform added to
 * the service before this file hears about it renders as `MASTODON` — ugly, and legible —
 * instead of as an empty option somebody cannot tell apart from "choose one".
 */
export function socialPlatformLabel(platform: string): string {
  return SOCIAL_PLATFORM_LABELS[platform as SocialPlatform] ?? platform;
}

/** Whether a string is one of the nine this client knows how to offer. */
export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/**
 * One account elsewhere — `SocialLinkBody`, in both directions.
 *
 * No identifier and no position, because the wire shape has neither: the order **is** the
 * order of the array, and a write replaces the whole list. See `saveOwnProfile`.
 *
 * `url` is a string somebody typed. The service refuses anything that is not `https://`, and
 * `OwnProfileResponse`'s Javadoc is explicit that what it cannot refuse is everything an
 * *ordinary* https link does when an indexable page publishes it — so every renderer of one
 * of these owes it `rel="nofollow ugc noopener noreferrer"`. `components/profile/ProfileAbout`
 * is where that is paid.
 */
export interface ProfileSocialLink {
  readonly platform: string;
  readonly url: string;
}

/**
 * A place from V16's closed vocabulary of eighteen — `LocationBody`.
 *
 * A slug and a resolved name, and no identifier: the slug is the address, the same way it is
 * for a category. The name is already in the reader's language when it arrives, so nothing
 * here chooses one.
 */
export interface ProfileLocation {
  readonly slug: string;
  readonly name: string;
}

/** A cover, as every projection in this application carries one. */
export interface CoverImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/**
 * The person, as `GET /v1/users/{slug}` describes them.
 *
 * Five fields and no e-mail address, no identifier and no visibility. The account's own
 * identifier is absent because nothing public is addressed by it — the slug is the address —
 * and `profile_visibility` is absent because a profile that answers at all is public by
 * definition, so a field saying so would carry no information and a field saying otherwise
 * could not exist.
 *
 * <h2>THERE ARE NO COUNTS ON THIS PROJECTION, AND THAT IS A BOUNDARY RATHER THAN AN OVERSIGHT</h2>
 *
 * "How many campaigns has this person created" is a question about `project`, and "how many
 * have they backed" is a question about `pledge`. Answering either from the `user` module —
 * the module every other module depends on — would make it depend on both in turn, which
 * `ModuleBoundaryTests` refuses outright. So the response carries none, and a client that
 * wants a number counts the rows it is already rendering.
 *
 * **Which means a client may only print a total it can actually know.** The lists are
 * paginated, so the length of a loaded page is a total exactly when there is no next cursor
 * and is a fraction otherwise. `components/profile/ProfileTabs` prints one under precisely
 * that condition and prints nothing the rest of the time; a figure that silently means "the
 * first twenty-four" is worse than no figure, because a reader has no way to tell which they
 * are looking at.
 *
 * <h2>Nulls are written out, deliberately</h2>
 *
 * Unlike most projections in this service, this one serialises `bio` and `avatarUrl` as
 * `null` rather than omitting them, so that "this person wrote no biography" and "the field I
 * expected is missing" are different things on the wire. They are typed as `T | null` and not
 * `?: T | null` for that reason: a caller that treated an absent key as "still loading" would
 * put a spinner over an answer it had already received.
 *
 * `socialLinks` goes the other way and is an **empty array, never null**, because an array is
 * a thing a client maps over — `PublicProfileResponse` says so in as many words.
 *
 * <h2>Eight fields since #276, and the three new ones are user-supplied addresses</h2>
 *
 * `websiteUrl` and every `socialLinks` address are strings a stranger typed into a form on a
 * page search engines index. The service refuses anything that is not `https://`, which
 * closes `javascript:` and `data:` outright — and closes nothing else.
 * `components/profile/ProfileAbout` carries the three `rel` tokens that close the rest, and
 * `OwnProfileResponse`'s Javadoc gives a different reason for each of them.
 */
export interface PublicProfile {
  readonly slug: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  /** §4.2 P-02. Plain text. `null` is a person who has written none, not a missing field. */
  readonly bio: string | null;
  /**
   * ISO-8601 instant, UTC.
   *
   * `null` only for a body that did not carry one. The projection always sends it, and this
   * type says `string | null` anyway because #323's narrowing is what enforces the shape now
   * and it cannot invent an instant it was not given. A renderer that treated the absence as a
   * date printed **January 1970** on somebody's profile; see `lib/profiles/wire.ts`.
   */
  readonly joinedAt: string | null;
  /** §4.2 P-02. `https://` only, and never fetched by the service that stores it. */
  readonly websiteUrl: string | null;
  /** §4.2 P-02. One of V16's eighteen places, or `null` for somebody who has not said. */
  readonly location: ProfileLocation | null;
  /** §4.2 P-03, in the order their owner put them. Empty rather than null. */
  readonly socialLinks: readonly ProfileSocialLink[];
}

/**
 * One campaign on a profile, in either list.
 *
 * Narrower than `lib/discovery/api.ts`'s card and deliberately not that type: the discovery
 * feed carries a badge, a `daysLeft` and a pre-computed `completionPercent` that the search
 * projection produces, and none of those exist here. Importing the feed's card would mean
 * either inventing those three fields on the client or rendering a card with three holes in
 * it.
 *
 * `goal` and `pledged` are `Money` — a string and a currency, never a JSON number
 * (CLAUDE.md §3). **Both are absent on the backed list.** They are optional here rather than
 * split into two types because the wire shape is one shape; see the module comment.
 */
export interface ProfileProjectCard {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly creatorSlug: string;
  readonly blurb: string | null;
  /** One of §6.1's nine publicly visible states. Widened, so an unknown one renders. */
  readonly state: string;
  readonly goal?: Money | null;
  readonly pledged?: Money | null;
  readonly backersCount: number;
  /** ISO-8601 instants, UTC. Null before a campaign has launched or has a deadline. */
  readonly deadline: string | null;
  readonly launchedAt: string | null;
  readonly coverImage: CoverImage | null;
}

/**
 * How many rows a page asks for.
 *
 * The same twenty-four `lib/community/signals.ts` uses, and for the same reason: it divides
 * by two, three and four, so the last row of the grid is full at every breakpoint this
 * application lays out.
 */
export const PROFILE_PAGE_SIZE = 24;

/**
 * A list response as `useCursorList` reads it.
 *
 * The service names the array after what is in it and the hook names it `items`, and this is
 * the one line that reconciles them. Renaming the field on the service would be the tidier
 * fix and is not this client's to make; renaming the hook's would be a change to two screens
 * that already ship.
 */
async function readProjectPage(
  path: string,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<Page<ProfileProjectCard>> {
  const query = new URLSearchParams({ limit: String(PROFILE_PAGE_SIZE) });
  if (cursor !== null) query.set('cursor', cursor);

  const response = await publicFetch(`${path}?${query.toString()}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  /*
   * The same narrowing the server render used for the first page — #323. The browser fetching
   * page two from the same endpoint through a different reader is how the two halves of one
   * list come to disagree about what a row with no slug is.
   */
  return readProjectCardPage((await response.json()) as unknown);
}

/** The public address of a profile. §10.2 addresses a person by slug and so does this. */
export function profileHref(slug: string): string {
  return `/u/${encodeURIComponent(slug)}`;
}

/** The public address of a campaign, from a card on either list. */
export function profileCampaignHref(card: ProfileProjectCard): string {
  return `/projects/${encodeURIComponent(card.creatorSlug)}/${encodeURIComponent(card.slug)}`;
}

/**
 * §4.2 P-05 — one page of the campaigns this person created.
 *
 * Only the nine publicly visible states of §6.1. A creator's drafts, submissions and
 * rejections are not on it, which is also why a count taken from this list is the only honest
 * one: a total computed anywhere else would be counting rows this list does not contain.
 */
export function listCreatedProjects(
  slug: string,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<Page<ProfileProjectCard>> {
  return readProjectPage(`/v1/users/${encodeURIComponent(slug)}/projects`, cursor, signal);
}

/**
 * §4.2 P-04 — one page of the campaigns this person backed, **with no amounts**.
 *
 * Two omissions, both the service's and neither reconstructible here:
 *
 *   - **no amounts of any kind.** Not what they pledged, and not what the campaign raised.
 *     P-04 is explicit, and the reason is that a public archive of what somebody spent is a
 *     financial profile of them that they did not publish.
 *   - **anonymous pledges are not on it** (§4.5 PL-12). A pledge made anonymously is hidden
 *     from public lists, and this is one.
 *
 * Both are enforced on the server, which is the only place they can be enforced: a client
 * that filtered would be a client that had already received the thing it was hiding.
 */
export function listBackedProjects(
  slug: string,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<Page<ProfileProjectCard>> {
  return readProjectPage(`/v1/users/${encodeURIComponent(slug)}/backed`, cursor, signal);
}

/**
 * §4.2 P-07 — `PATCH /v1/me/profile-visibility`.
 *
 * 204 and no body. The account is the caller's, so there is no identifier in the path: an
 * endpoint that took one would be an endpoint somebody would eventually try to point at
 * somebody else.
 */
export async function setProfileVisibility(visibility: ProfileVisibility): Promise<void> {
  const response = await authorizedFetch('/v1/me/profile-visibility', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ visibility }),
  });

  if (!response.ok) throw await errorFrom(response);
}

/**
 * What visibility the account's own profile is currently set to — **read from its effect**.
 *
 * <h2>Why this exists at all</h2>
 *
 * P-07's control is a write and there is no matching read: `GET /v1/me` carries six fields
 * and `profileVisibility` is not one of them. A switch that cannot show its own position is
 * not a switch, and the alternatives were both bad — guess `PUBLIC` because that is the
 * column default, which is a lie to everybody who has already turned it off; or offer two
 * buttons and no state, which asks somebody to make a decision the interface will not tell
 * them they have already made.
 *
 * So the setting is read from the thing it decides. `GET /v1/users/{slug}` answers 200 for a
 * public profile and 404 for a private one, and for the caller's own slug — an account that
 * is signed in, and therefore neither unknown nor closed — those are the only two answers
 * the contract allows. That makes the probe exact rather than a heuristic.
 *
 * <h2>It is deliberately anonymous, and that is the point rather than an economy</h2>
 *
 * A plain `fetch` rather than `publicFetch`, because `publicFetch` attaches the access token
 * when there is one and the question being asked is *what does a stranger see*. If the
 * service ever chose to show an owner their own hidden profile, a request carrying the
 * owner's token would answer 200 for a private account and the switch would read the
 * opposite of the truth. `credentials: 'omit'` makes the request unable to be recognised,
 * which is the only way to be sure the answer is the visitor's.
 *
 * `null` means neither — the service was unreachable, or answered something the contract
 * does not describe. The panel renders that as "not known" and refuses to move a switch it
 * cannot position, rather than picking a default and writing over somebody's choice.
 */
export async function probeProfileVisibility(
  slug: string,
  signal?: AbortSignal,
): Promise<ProfileVisibility | null> {
  const response = await fetch(`/v1/users/${encodeURIComponent(slug)}`, {
    credentials: 'omit',
    headers: { accept: 'application/json' },
    // Never a stored copy: the answer is what the previous write just changed.
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });

  if (response.ok) return 'PUBLIC';
  if (response.status === 404) return 'PRIVATE';
  return null;
}

/* -------------------------------------------------------------------------
 * The owner's own profile — §4.2 P-01 to P-03, issue #276
 * ---------------------------------------------------------------------- */

/**
 * The caller's own profile, as `GET /v1/me/profile` sends it.
 *
 * <h2>It is not `PublicProfile`, and the difference is one field each way</h2>
 *
 * This one carries no `joinedAt` — the editor has nothing to do with when the account was
 * created — and it carries `slug` for a reason the public projection does not need: the
 * editor has to show somebody their own handle and say that it is not theirs to change.
 * Reusing the public interface would mean either a `joinedAt` this endpoint never sends or an
 * optional field on the type every public caller then has to narrow.
 *
 * <h2>Hand-written, not `@ideanest/api-client`'s generated type</h2>
 *
 * `lib/community/updates.ts` states the reason and it holds here unchanged: **every field of
 * the generated type is optional**, because springdoc marks a record component nullable
 * unless it is annotated otherwise. A form built on that type would narrow `name` from
 * `string | undefined` at every use and would have lost the one distinction this response
 * exists to make — `bio: null` is "this person wrote none" and a missing key is a response
 * that did not arrive.
 */
export interface OwnProfile {
  readonly name: string;
  /** Readable, and **not writable**. `PATCH /v1/me/profile` has no key for it. */
  readonly slug: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly websiteUrl: string | null;
  readonly location: ProfileLocation | null;
  /** Empty rather than null, in the order their owner put them. */
  readonly socialLinks: readonly ProfileSocialLink[];
}

/**
 * A partial edit — `PATCH /v1/me/profile`, with **three-way** semantics on every key.
 *
 *   - **absent** — leave the stored value alone
 *   - **`null`** — clear it
 *   - **a value** — set it
 *
 * `JSON.stringify` drops a key whose value is `undefined`, so "absent" is what an optional
 * property already produces and no caller has to build the body conditionally. That is worth
 * stating rather than relying on quietly, because it is the difference between a form that
 * saves the field somebody edited and one that writes its own blank defaults over the five
 * they did not touch.
 *
 * **`name` cannot be cleared.** `users.name` is `NOT NULL`, so the key takes a string and
 * never `null`; an empty one is a 400 naming `name`, not a clear.
 *
 * **`socialLinks` is written as a whole list, never merged.** Sending it replaces every row,
 * in the order given; omitting it leaves every row alone. There is no per-link write and
 * `SocialLinkBody` explains why one would be a second write path nobody asked for — so a
 * caller that wants to delete one link sends the other four.
 */
export interface ProfileEdit {
  readonly name?: string;
  readonly bio?: string | null;
  readonly avatarUrl?: string | null;
  readonly websiteUrl?: string | null;
  /** A slug from `GET /v1/locations`. Anything else is a 400 naming `locationSlug`. */
  readonly locationSlug?: string | null;
  readonly socialLinks?: readonly ProfileSocialLink[];
}

/** How many links a profile may carry — `ProfileEditing.MAX_SOCIAL_LINKS`. */
export const MAX_SOCIAL_LINKS = 5;

/** `users.name`, in characters. */
export const PROFILE_NAME_MAX_CHARACTERS = 80;

/** `users.bio`, in characters. */
export const PROFILE_BIO_MAX_CHARACTERS = 2000;

/**
 * The caller's own profile.
 *
 * `authorizedFetch`, unlike the three reads above it: this is one account's own data behind a
 * bearer token, and the service answers it `private, no-store`. There is nothing here a
 * signed-out visitor could be shown, so throwing without a token is the right shape.
 */
export async function readOwnProfile(signal?: AbortSignal): Promise<OwnProfile> {
  const response = await authorizedFetch('/v1/me/profile', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as OwnProfile;
}

/**
 * Writes what changed, and answers the profile **as it now stands**.
 *
 * <h2>The response is the new state, and the caller must render from it</h2>
 *
 * 200 with the full profile rather than 204, and `OwnProfileController` gives the reason: the
 * result is not inferable from the request. The location comes back as a slug *and* a
 * resolved name the client never sent, text comes back trimmed, and every key the request
 * omitted comes back holding a value this browser may never have held. A form that kept
 * rendering its own draft after a save would show untrimmed text and an empty location name
 * until somebody reloaded.
 *
 * An empty edit is a successful no-op that returns the current profile, which is what a form
 * with nothing changed sends.
 */
export async function saveOwnProfile(edit: ProfileEdit): Promise<OwnProfile> {
  const response = await authorizedFetch('/v1/me/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(edit),
  });

  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as OwnProfile;
}

/** A refusal from `ProfileEditing`, matched to the control it is about. */
export interface ProfileFieldRefusal {
  /** `name`, `bio`, `avatarUrl`, `websiteUrl`, `locationSlug` or `socialLinks`. */
  readonly field: string;
  /** The service's own sentence, which says which of its rules was broken. */
  readonly message: string;
}

/**
 * The field a `400 PROFILE_FIELD_INVALID` is about, or `null` for anything else.
 *
 * <h2>Branching on `code`, never on `detail`</h2>
 *
 * `Problem.code` is the stable machine-readable reason; `detail` is prose that may be
 * reworded or localised at any time. The field travels in `meta.field` for exactly this
 * purpose — `ProfileExceptionHandler` says the point of it is that the editor can put the
 * message beside the input that caused it rather than in a banner over a form with six
 * controls in it. It is deliberately the same shape as `PROJECT_FIELD_INVALID`, so this is
 * `fieldErrorsFrom` (`@ideanest/campaign-editor/rewards`) with one `code` changed.
 *
 * `meta` is `Record<string, unknown>`, so the type of `field` is checked rather than asserted:
 * a service that one day sent a number there would otherwise put `[object Object]` under an
 * input.
 */
export function profileFieldRefusal(cause: unknown): ProfileFieldRefusal | null {
  if (!(cause instanceof ApiError)) return null;
  if (cause.problem?.code !== 'PROFILE_FIELD_INVALID') return null;

  const field = cause.problem.meta?.['field'];
  if (typeof field !== 'string') return null;

  return { field, message: cause.problem.detail ?? cause.message };
}
