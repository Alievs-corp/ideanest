'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { CharacterCount, Field, InlineAlert, Pill, Select, TextInput, Textarea } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { characterCount } from '../../lib/projects/basics';
import {
  PROFILE_BIO_MAX_CHARACTERS,
  PROFILE_NAME_MAX_CHARACTERS,
  profileFieldRefusal,
  profileHref,
  readOwnProfile,
  saveOwnProfile,
  type OwnProfile,
  type ProfileEdit,
  type ProfileLocation,
  type ProfileSocialLink,
} from '../../lib/profiles/api';
import { listProfileLocations } from '../../lib/profiles/locations';
import { useSession } from '../session/SessionProvider';
import { ProfileAvatarField } from './ProfileAvatarField';
import { SocialLinksField } from './SocialLinksField';
import type { ProfileEditorCopy } from '../../lib/i18n/profile-copy';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * §4.2's P-01, P-02 and P-03 — the profile editor. Issue #276.
 *
 * <h2>It renders from the response, never from its own draft</h2>
 *
 * `PATCH /v1/me/profile` answers **200 with the whole profile** rather than 204, and
 * `OwnProfileController` gives the reason: the result is not inferable from the request. The
 * location comes back as a slug *and* a resolved name this browser never sent, text comes
 * back trimmed, and every key the request omitted comes back holding a value this session may
 * never have held. So the answer replaces both the stored profile and the draft, and what is
 * on screen after a save is what the service says is there.
 *
 * <h2>THE PATCH IS A DIFF, AND THAT IS THE WHOLE POINT OF THE ENDPOINT</h2>
 *
 * Every key is three-way: absent leaves the stored value alone, `null` clears it, a value
 * sets it. `editFrom` compares the draft against the profile the service last sent and emits
 * only what differs — so a form opened, read and saved sends `{}` and writes nothing, and a
 * biography somebody deleted sends `bio: null` rather than `bio: ""`.
 *
 * The alternative — sending all six fields every time — is the failure this shape exists to
 * prevent. Two tabs open on one account would each write their own copy of the four fields
 * they were not editing, and the second save would silently undo the first.
 *
 * <h2>There is no second copy of the service's validation here, deliberately</h2>
 *
 * `ProfileEditing` decides what a name, a biography and an address may be: 1–80 characters,
 * 2000 characters, `https://` with no whitespace and a length between 12 and 512. **None of
 * those rules is re-implemented in this file.** Every one of them refuses with a `400
 * PROFILE_FIELD_INVALID` naming the field in `meta.field`, and `profileFieldRefusal` puts the
 * service's own sentence under the control it is about — which is the outcome a client-side
 * copy would be trying to reach, minus the drift. A duplicated rule that is stricter than the
 * service refuses something valid; one that is laxer is a round trip that tells somebody the
 * same thing a moment later. The bounds still appear on screen, as hints and as
 * `CharacterCount`, because saying what the rule is costs nothing and enforcing it twice does.
 *
 * What *is* prevented structurally is what a control can make unreachable rather than
 * invalid: `SocialLinksField` cannot offer a sixth row or a duplicated platform, because
 * those are states rather than values.
 *
 * <h2>The handle is shown and is not a field</h2>
 *
 * `slug` is on the read and on no write. It is rendered as a sentence saying so, and not as a
 * disabled input: a greyed box with no explanation tells somebody that the thing they want is
 * broken rather than that it is deliberate. `/u/{slug}` is linked from every campaign page
 * this account publishes, which is the reason it does not move.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 — "authentication, **account settings**: none, 150ms colour on
 * controls". Nothing on this route imports `@ideanest/ui/motion`, there is no `FadeUp`, and
 * the save confirmation appears rather than arriving: §5's own reason is that an animated
 * message is one that turns up after it was needed.
 */

/** The keys `meta.field` can name, which are the controls this form has. */
type ProfileField =
  | 'name'
  | 'bio'
  | 'avatarUrl'
  | 'websiteUrl'
  | 'locationSlug'
  | 'socialLinks';

const PROFILE_FIELDS: readonly ProfileField[] = [
  'name',
  'bio',
  'avatarUrl',
  'websiteUrl',
  'locationSlug',
  'socialLinks',
];

function isProfileField(value: string): value is ProfileField {
  return (PROFILE_FIELDS as readonly string[]).includes(value);
}

/**
 * The form's own state.
 *
 * Every scalar is the string its control holds, never `string | null`. A `<textarea>` cannot
 * hold `null` while somebody is deleting the last character of a biography, so the draft
 * keeps text and the conversion to "cleared" happens once, on the way out — which is also the
 * only place it can be got right, since `""` and `null` mean different things to the endpoint
 * and identical things to a person looking at an empty box.
 */
interface ProfileDraft {
  readonly name: string;
  readonly bio: string;
  readonly avatarUrl: string;
  readonly websiteUrl: string;
  /** A location slug, or `''` for "not saying". */
  readonly locationSlug: string;
  readonly socialLinks: readonly ProfileSocialLink[];
}

function draftFrom(profile: OwnProfile): ProfileDraft {
  return {
    name: profile.name,
    bio: profile.bio ?? '',
    avatarUrl: profile.avatarUrl ?? '',
    websiteUrl: profile.websiteUrl ?? '',
    locationSlug: profile.location?.slug ?? '',
    socialLinks: profile.socialLinks.map((link) => ({ platform: link.platform, url: link.url })),
  };
}

/** An emptied box is a cleared field, which on this endpoint is `null` and never `""`. */
function clearedOrTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function linksMatch(
  left: readonly ProfileSocialLink[],
  right: readonly ProfileSocialLink[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((link, index) => {
    const other = right[index];
    return other !== undefined && other.platform === link.platform && other.url === link.url;
  });
}

/**
 * What actually changed, as `PATCH /v1/me/profile` wants it.
 *
 * A key is present only where the draft and the last response disagree, so an untouched field
 * never reaches the wire. `JSON.stringify` drops an `undefined` value, so "absent" needs no
 * conditional spread and cannot be got wrong by adding a seventh field later.
 *
 * **`socialLinks` is all or nothing**, because the endpoint replaces the whole list: one
 * changed address means the other four are sent again, in order, and an untouched list means
 * the key is absent entirely.
 */
function editFrom(profile: OwnProfile, draft: ProfileDraft): ProfileEdit {
  const edit: {
    name?: string;
    bio?: string | null;
    avatarUrl?: string | null;
    websiteUrl?: string | null;
    locationSlug?: string | null;
    socialLinks?: readonly ProfileSocialLink[];
  } = {};

  /*
   * The name is the one field that cannot be cleared — `users.name` is NOT NULL — so it is
   * compared as a string and never becomes `null`. An emptied one is sent as `""` and refused
   * by the service, which is the honest outcome: the message says a name is between 1 and 80
   * characters, and it appears under the name.
   */
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

  const links = draft.socialLinks.map((link) => ({
    platform: link.platform,
    url: link.url.trim(),
  }));
  if (!linksMatch(links, profile.socialLinks)) edit.socialLinks = links;

  return edit;
}

export interface ProfileEditorPanelProps {
  /** Every word this form and its two fields draw, resolved on the server — #82. */
  readonly copy: ProfileEditorCopy;
}

export function ProfileEditorPanel({ copy }: ProfileEditorPanelProps) {
  const { status, refresh } = useSession();

  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);

  const [locations, setLocations] = useState<readonly ProfileLocation[] | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    if (status !== 'signed-in') return;

    const controller = new AbortController();

    void readOwnProfile(controller.signal)
      .then((answer) => {
        if (controller.signal.aborted) return;
        setProfile(answer);
        setDraft(draftFrom(answer));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoadFailure(
          cause instanceof ApiError ? (cause.problem?.detail ?? cause.message) : copy.loadFailed,
        );
      });

    return () => controller.abort();
  }, [status]);

  /*
   * The gazetteer is a second request and a failure of it is NOT a failure of this screen.
   * `locations` stays `null`, the `<select>` is replaced by a sentence, and the other five
   * fields still save — `editFrom` omits `locationSlug` when nothing changed it, so a save
   * made while the list was unavailable cannot clear a location somebody set last year.
   */
  useEffect(() => {
    if (status !== 'signed-in') return;

    const controller = new AbortController();

    void listProfileLocations(controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setLocations(answer);
      })
      .catch(() => {
        // Recorded by `locations` staying null. There is nothing to say beyond the sentence
        // rendered below, and a second banner about a `<select>` would outweigh the control.
      });

    return () => controller.abort();
  }, [status]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || profile === null || draft === null) return;

    setSaving(true);
    setSaved(false);
    setFailure(null);
    setFieldErrors({});

    try {
      const answer = await saveOwnProfile(editFrom(profile, draft));
      setProfile(answer);
      setDraft(draftFrom(answer));
      setSaved(true);

      /*
       * The account's name is on `GET /v1/me` and is what the site header prints, so a name
       * that has just changed here is stale everywhere else on the page until the session is
       * re-read. `EmailChangePanel` deliberately does NOT refresh, and the difference is real:
       * nothing about the account changed there until a link is opened, and everything the
       * session carries about this one may have changed here.
       */
      await refresh();
    } catch (cause) {
      const refusal = profileFieldRefusal(cause);

      if (refusal !== null && isProfileField(refusal.field)) {
        setFieldErrors({ [refusal.field]: refusal.message });
        /*
         * No banner as well. The sentence is under the control it is about, and repeating it
         * at the top of the form would have somebody fix one thing and read about it twice.
         */
        setFailure(null);
      } else {
        setFailure(
          cause instanceof ApiError ? (cause.problem?.detail ?? cause.message) : copy.unreachable,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function change(patch: Partial<ProfileDraft>): void {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
    // A confirmation that outlives the state it described is a confirmation that lies.
    setSaved(false);
  }

  if (status !== 'signed-in') {
    /*
     * Nothing at all while the session is unknown. `SessionProvider` guards `/settings`, so a
     * signed-out reader is being redirected rather than shown an empty form, and rendering
     * the controls in the meantime would put somebody's name in a box before this screen
     * knows whose name it is.
     */
    return null;
  }

  return (
    <section className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{copy.heading}</h2>

      {profile !== null && (
        <div className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-white/64">
          {/*
            The address is a link rather than a string, so the sentence is filled with nodes:
            where it falls is exactly what a translation is entitled to move, and a "before"
            key and an "after" key would buy the link at the cost of word order.
          */}
          <p>
            {fillNodes(copy.liveAt, {
              address: (
                <Link
                  href={profileHref(profile.slug)}
                  className="rounded-sm text-white underline underline-offset-4"
                >
                  /u/{profile.slug}
                </Link>
              ),
            })}
          </p>
          {/*
            THE HANDLE, SAID RATHER THAN GREYED OUT. `PATCH /v1/me/profile` has no key for
            `slug`, so there is no field below to disable — and a disabled box with no
            sentence beside it reads as something broken rather than as something decided.
          */}
          <p className="mt-3">
            <strong className="font-medium text-white">
              {fillPlaceholders(copy.handleFixed, { slug: profile.slug })}
            </strong>{' '}
            {copy.handleWhy}
          </p>
        </div>
      )}

      {loadFailure !== null && (
        <div className="mt-6">
          <InlineAlert variant="danger" title={copy.loadFailedTitle}>
            <p>{loadFailure}</p>
          </InlineAlert>
        </div>
      )}

      {profile === null && loadFailure === null && (
        <p className="mt-6 text-sm text-white/40">{copy.loading}</p>
      )}

      {profile !== null && draft !== null && (
        <form onSubmit={submit} noValidate className="mt-8 flex max-w-[38rem] flex-col gap-6">
          {failure !== null && (
            <InlineAlert variant="danger" title={copy.saveFailedTitle}>
              <p>{failure}</p>
            </InlineAlert>
          )}

          <Field
            label={copy.name}
            required
            hint={fillPlaceholders(copy.nameHint, { max: String(PROFILE_NAME_MAX_CHARACTERS) })}
            error={fieldErrors['name']}
          >
            {/*
              No `maxLength`. A hard cap truncates a pasted value without saying so and takes
              the counter's one useful message away: "3 characters too many" is actionable,
              silently losing three letters is not. `BasicsPanel` says the same of a title.
            */}
            <TextInput
              name="name"
              autoComplete="name"
              value={draft.name}
              disabled={saving}
              onChange={(event) => change({ name: event.target.value })}
            />
            <CharacterCount
              count={characterCount(draft.name)}
              limit={PROFILE_NAME_MAX_CHARACTERS}
            />
          </Field>

          <Field
            label={copy.bio}
            hint={fillPlaceholders(copy.bioHint, { max: String(PROFILE_BIO_MAX_CHARACTERS) })}
            error={fieldErrors['bio']}
          >
            <Textarea
              name="bio"
              rows={6}
              value={draft.bio}
              disabled={saving}
              onChange={(event) => change({ bio: event.target.value })}
            />
            {/*
              Counted in code points rather than in `String.length`, because the column is
              counted that way: `lib/projects/basics.ts` explains why an emoji that counts as
              two would tell somebody they were over a limit Postgres was happy with. Imported
              rather than copied — one counter, or two that disagree about the same string.
            */}
            <CharacterCount
              count={characterCount(draft.bio)}
              limit={PROFILE_BIO_MAX_CHARACTERS}
            />
          </Field>

          <ProfileAvatarField
            url={draft.avatarUrl}
            name={draft.name}
            disabled={saving}
            error={fieldErrors['avatarUrl']}
            onUrlChange={(url) => change({ avatarUrl: url })}
            copy={copy.avatar}
          />

          <Field
            label={copy.website}
            hint={copy.websiteHint}
            error={fieldErrors['websiteUrl']}
          >
            <TextInput
              type="url"
              inputMode="url"
              name="websiteUrl"
              autoComplete="url"
              value={draft.websiteUrl}
              disabled={saving}
              placeholder={copy.websitePlaceholder}
              onChange={(event) => change({ websiteUrl: event.target.value })}
            />
          </Field>

          <Field
            label={copy.location}
            hint={copy.locationHint}
            error={fieldErrors['locationSlug']}
            /*
              `grouped` exactly when there is no control below. docs/ui-kit.md §7.13's rule is
              that a label with nothing to point `htmlFor` at names its contents through
              `aria-labelledby` instead — and the unavailable branch is a sentence, not a
              `<select>`, so a plain label there would be a label pointing at an id nothing
              carries.
            */
            grouped={locations === null}
          >
            {locations === null ? (
              /*
                The list could not be read, so there is no control — not a control with
                nothing in it. What the profile already says is still printed, because a
                screen that showed an empty box would read as a location somebody had lost.
              */
              <p className="text-sm text-white/40">
                {profile.location === null
                  ? copy.locationsUnavailable
                  : fillPlaceholders(copy.locationsUnavailableWithValue, {
                      place: profile.location.name,
                    })}
              </p>
            ) : (
              <Select
                name="locationSlug"
                value={draft.locationSlug}
                disabled={saving}
                onChange={(event) => change({ locationSlug: event.target.value })}
              >
                {/*
                  A real, selectable option rather than `Select`'s `placeholder`, which
                  renders a DISABLED empty row. "Nothing chosen yet" is the right shape for a
                  field that must end up with a value; this one must be clearable, and a
                  disabled empty option is one somebody can leave and never return to.
                */}
                <option value="">{copy.notSaying}</option>
                {locations.map((location) => (
                  <option key={location.slug} value={location.slug}>
                    {location.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <SocialLinksField
            links={draft.socialLinks}
            disabled={saving}
            error={fieldErrors['socialLinks']}
            onChange={(links) => change({ socialLinks: links })}
            copy={copy.links}
          />

          <div className="flex flex-wrap items-center gap-4">
            <Pill type="submit" disabled={saving}>
              {saving ? copy.saving : copy.save}
            </Pill>
          </div>

          {/*
            Polite rather than an alert: "saved" is not worth interrupting a screen reader
            mid-sentence for, and an alert that fires on every success stops being an alert.
            The region is rendered on every pass so that it is registered before anything is
            put into it — `CoverImageField` gives the same reason.
          */}
          <div role="status" aria-live="polite" className="empty:hidden">
            {saved && (
              <InlineAlert variant="success" title={copy.savedTitle}>
                <p>
                  {fillNodes(copy.savedBody, {
                    address: (
                      <Link
                        href={profileHref(profile.slug)}
                        className="text-white underline underline-offset-4"
                      >
                        /u/{profile.slug}
                      </Link>
                    ),
                  })}
                </p>
              </InlineAlert>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
