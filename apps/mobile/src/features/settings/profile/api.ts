import { ApiError, type components } from '@ideanest/api-client';
import { api, publicApi, sendJson } from '../../../api/client';

/**
 * The owner's own profile — the web's `lib/profiles/api.ts` and `lib/profiles/locations.ts`
 * (#161). Hand-narrowed rather than the generated types, whose every field is optional: `bio:
 * null` is "wrote none", and a form must not have to guess at a missing name.
 */

type GeneratedPlatform = NonNullable<components['schemas']['SocialLinkBody']['platform']>;

/** `SocialPlatform` on the service, in the web's order. Checked against the contract both ways. */
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
] as const satisfies readonly GeneratedPlatform[];

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// A platform the contract gained and this list did not is a compile error here.
const EVERY_PLATFORM_LISTED: Exclude<GeneratedPlatform, SocialPlatform> extends never ? true : never =
  true;
void EVERY_PLATFORM_LISTED;

/** Brand names, which are not translated — the web keeps them in code for the same reason. */
const PLATFORM_LABELS: Readonly<Record<SocialPlatform, string>> = {
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

/** The identifier itself for a platform this build does not know: legible, never empty. */
export function socialPlatformLabel(platform: string): string {
  return isSocialPlatform(platform) ? PLATFORM_LABELS[platform] : platform;
}

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/** `ProfileEditing.MAX_SOCIAL_LINKS`. */
export const MAX_SOCIAL_LINKS = 5;
/** `users.name` and `users.bio`, in characters (code points). */
export const PROFILE_NAME_MAX_CHARACTERS = 80;
export const PROFILE_BIO_MAX_CHARACTERS = 2000;

export interface ProfileSocialLink {
  readonly platform: string;
  readonly url: string;
}

export interface ProfileLocation {
  readonly slug: string;
  readonly name: string;
}

export interface OwnProfile {
  readonly name: string;
  /** Readable, never writable. */
  readonly slug: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly websiteUrl: string | null;
  readonly location: ProfileLocation | null;
  readonly socialLinks: readonly ProfileSocialLink[];
}

/** The public address as it is printed — `/u/{slug}`, the web's `profileHref`. */
export function profilePath(slug: string): string {
  return `/u/${slug}`;
}

/** `PATCH /v1/me/profile`: absent leaves a key alone, `null` clears it, a value sets it. */
export interface ProfileEdit {
  readonly name?: string;
  readonly bio?: string | null;
  readonly avatarUrl?: string | null;
  readonly websiteUrl?: string | null;
  readonly locationSlug?: string | null;
  readonly socialLinks?: readonly ProfileSocialLink[];
}

type Generated = components['schemas']['OwnProfileResponse'];

/** The response as this screen reads it. `null` for every absent scalar, `[]` for the links. */
export function ownProfileFrom(body: Generated | null | undefined): OwnProfile {
  const location = body?.location;
  return {
    name: body?.name ?? '',
    slug: body?.slug ?? '',
    bio: body?.bio ?? null,
    avatarUrl: body?.avatarUrl ?? null,
    websiteUrl: body?.websiteUrl ?? null,
    location:
      location?.slug === undefined ? null : { slug: location.slug, name: location.name ?? location.slug },
    socialLinks: (body?.socialLinks ?? []).map((link) => ({
      platform: link.platform ?? '',
      url: link.url ?? '',
    })),
  };
}

export async function readOwnProfile(signal?: AbortSignal): Promise<OwnProfile> {
  return ownProfileFrom(await api().get('/v1/me/profile', signal === undefined ? {} : { signal }));
}

/** Answers the profile as it now stands, which the form renders from. */
export async function saveOwnProfile(edit: ProfileEdit): Promise<OwnProfile> {
  return ownProfileFrom((await sendJson('PATCH', '/v1/me/profile', edit)) as Generated | null);
}

/**
 * `GET /v1/locations`, in the service's order and language. Read as nobody: it is a gazetteer,
 * `permitAll`, and the same for every reader.
 */
export async function listProfileLocations(signal?: AbortSignal): Promise<readonly ProfileLocation[]> {
  const body = await publicApi().get('/v1/locations', signal === undefined ? {} : { signal });
  return (body.items ?? []).flatMap((row) =>
    row.slug === undefined ? [] : [{ slug: row.slug, name: row.name ?? row.slug }],
  );
}

/** A `400 PROFILE_FIELD_INVALID`'s field and the service's sentence, or `null` for anything else. */
export function profileFieldRefusal(
  cause: unknown,
): { readonly field: string; readonly message: string } | null {
  if (!(cause instanceof ApiError)) return null;
  if (cause.problem?.code !== 'PROFILE_FIELD_INVALID') return null;
  const field = cause.problem.meta?.['field'];
  if (typeof field !== 'string') return null;
  return { field, message: cause.problem.detail ?? cause.message };
}
