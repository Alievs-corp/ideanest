import type { OwnProfile, ProfileEdit, ProfileSocialLink } from './api';

/**
 * The profile form's state and the Merge-Patch it becomes — the web's `ProfileEditorPanel`
 * `draftFrom` / `editFrom`, kept pure so the rule is tested without a screen (#161).
 *
 * Only what differs from the last response is sent: a form opened and saved untouched sends
 * `{}`, and another device's edit to a field this one did not touch is not written back over.
 */

/** The keys `meta.field` can name, which are this form's controls. */
export const PROFILE_FIELDS = [
  'name',
  'bio',
  'avatarUrl',
  'websiteUrl',
  'locationSlug',
  'socialLinks',
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export function isProfileField(value: string): value is ProfileField {
  return (PROFILE_FIELDS as readonly string[]).includes(value);
}

/** Every scalar as the text its control holds; `''` is "nothing", converted once on the way out. */
export interface ProfileDraft {
  readonly name: string;
  readonly bio: string;
  readonly avatarUrl: string;
  readonly websiteUrl: string;
  /** A location slug, or `''` for "not saying". */
  readonly locationSlug: string;
  readonly socialLinks: readonly ProfileSocialLink[];
}

export function draftFrom(profile: OwnProfile): ProfileDraft {
  return {
    name: profile.name,
    bio: profile.bio ?? '',
    avatarUrl: profile.avatarUrl ?? '',
    websiteUrl: profile.websiteUrl ?? '',
    locationSlug: profile.location?.slug ?? '',
    socialLinks: profile.socialLinks.map((link) => ({ platform: link.platform, url: link.url })),
  };
}

/** An emptied box clears the field, which on this endpoint is `null` and never `""`. */
function clearedOrTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function linksMatch(left: readonly ProfileSocialLink[], right: readonly ProfileSocialLink[]): boolean {
  return (
    left.length === right.length &&
    left.every((link, index) => {
      const other = right[index];
      return other !== undefined && other.platform === link.platform && other.url === link.url;
    })
  );
}

/**
 * What changed, as `PATCH /v1/me/profile` wants it. The name is never `null` (`users.name` is
 * NOT NULL): an emptied one is sent as `""` and the service's refusal lands under it.
 * `socialLinks` is the whole list or absent, because a write replaces every row.
 */
export function editFrom(profile: OwnProfile, draft: ProfileDraft): ProfileEdit {
  const edit: {
    name?: string;
    bio?: string | null;
    avatarUrl?: string | null;
    websiteUrl?: string | null;
    locationSlug?: string | null;
    socialLinks?: readonly ProfileSocialLink[];
  } = {};

  const name = draft.name.trim();
  if (name !== profile.name) edit.name = name;

  const bio = clearedOrTrimmed(draft.bio);
  if (bio !== profile.bio) edit.bio = bio;

  const avatarUrl = clearedOrTrimmed(draft.avatarUrl);
  if (avatarUrl !== profile.avatarUrl) edit.avatarUrl = avatarUrl;

  const websiteUrl = clearedOrTrimmed(draft.websiteUrl);
  if (websiteUrl !== profile.websiteUrl) edit.websiteUrl = websiteUrl;

  const locationSlug = draft.locationSlug === '' ? null : draft.locationSlug;
  if (locationSlug !== (profile.location?.slug ?? null)) edit.locationSlug = locationSlug;

  const links = draft.socialLinks.map((link) => ({ platform: link.platform, url: link.url.trim() }));
  if (!linksMatch(links, profile.socialLinks)) edit.socialLinks = links;

  return edit;
}

/** Characters as the column counts them: code points, so an emoji is one, not two. */
export function characterCount(value: string): number {
  return Array.from(value).length;
}
