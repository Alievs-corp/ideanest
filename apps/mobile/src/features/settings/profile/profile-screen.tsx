import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { fillNodes } from '@ideanest/messages/placeholders';
import { queryKeys } from '../../../api/queries';
import {
  announce,
  Body,
  CharacterCount,
  ErrorState,
  Field,
  InlineAlert,
  Pill,
  Select,
  Skeleton,
  SkeletonGroup,
  Textarea,
  TextInput,
} from '../../../components/ui';
import { ACCOUNT_KEYS } from '../../../lib/account';
import { useOnline } from '../../../lib/connectivity';
import { useT } from '../../../lib/i18n';
import { useSession } from '../../../lib/use-session';
import { spacing } from '../../../theme';
import { InlineLink, SettingsCard, SettingsPage, Strong } from '../settings-page';
import {
  listProfileLocations,
  PROFILE_BIO_MAX_CHARACTERS,
  PROFILE_NAME_MAX_CHARACTERS,
  profileFieldRefusal,
  profilePath,
  readOwnProfile,
  saveOwnProfile,
  type OwnProfile,
} from './api';
import { AvatarField } from './avatar-field';
import {
  characterCount,
  draftFrom,
  editFrom,
  isProfileField,
  type ProfileDraft,
  type ProfileField,
} from './profile-edit';
import { SocialLinksField } from './social-links-field';

/**
 * `settings/profile` — the web's `/settings/profile` page and `ProfileEditorPanel` (#161).
 *
 * The form renders from the service's answer, never from its own draft: a save sends only what
 * changed (`editFrom`), and the response — trimmed text, a resolved location name — replaces
 * both the baseline and the draft. A background refetch does not touch a draft being edited.
 * The service's rules are not repeated here; a `PROFILE_FIELD_INVALID` lands under its field.
 */
export function ProfileSettingsScreen() {
  const t = useT('settings.pages.profile');
  return (
    <SettingsPage
      section="profile"
      title={t('title')}
      intro={t.rich('intro', {
        privacy: (chunks) => (
          <InlineLink href="/settings/privacy" testID="profile-privacy-link">
            {chunks}
          </InlineLink>
        ),
      })}
    >
      <ProfileEditor />
    </SettingsPage>
  );
}

const SKELETON_FIELDS = ['name', 'bio', 'avatar', 'website', 'location'] as const;

function ProfileEditor() {
  const t = useT('profile.editor');
  const tAll = useT();
  const online = useOnline();
  const { signedIn } = useSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.ownProfile(),
    queryFn: ({ signal }) => readOwnProfile(signal),
    enabled: signedIn,
  });
  // A second read whose failure is not this screen's: the picker becomes a sentence.
  const locations = useQuery({
    queryKey: queryKeys.locations(),
    queryFn: ({ signal }) => listProfileLocations(signal),
    enabled: signedIn,
    staleTime: 60 * 60_000,
  });

  const [baseline, setBaseline] = useState<OwnProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const inFlight = useRef(false);

  /*
   * Only a read made since this screen opened seeds the form: the cache can be days old, and a
   * save of `socialLinks` replaces the whole list, so a stale baseline would delete a link added
   * on the web. Offline (the read paused) the cached copy is shown, read-only.
   */
  const ready =
    query.data !== undefined && (query.isFetchedAfterMount || query.fetchStatus === 'paused');
  const cachedOnly = !query.isFetchedAfterMount;

  useEffect(() => {
    if (!ready || query.data === undefined || query.data === baseline) return;
    // A newer answer replaces the form only while nothing in it has been changed.
    const untouched =
      baseline === null || draft === null || Object.keys(editFrom(baseline, draft)).length === 0;
    if (!untouched) return;
    setBaseline(query.data);
    setDraft(draftFrom(query.data));
  }, [ready, query.data, baseline, draft]);

  const savedWords =
    saved && baseline !== null ? `${t('savedTitle')}. ${t('savedBody', { address: profilePath(baseline.slug) })}` : '';
  useEffect(() => {
    // Android's live region speaks on its own; iOS has none.
    if (Platform.OS === 'ios' && savedWords !== '') announce(savedWords);
  }, [savedWords]);

  if (!ready || baseline === null || draft === null) {
    // Offline with nothing in memory: a service refusal is still shown as one.
    const answered = query.error instanceof ApiError;
    if (query.data === undefined && !answered && (!online || query.fetchStatus === 'paused')) {
      return (
        <InlineAlert
          variant="warning"
          politeness="polite"
          description={tAll('mobile.offline.nothingCached')}
          testID="profile-offline-empty"
        />
      );
    }
    if (query.isError) {
      const cause = query.error;
      return (
        <ErrorState
          title={t('loadFailedTitle')}
          description={
            cause instanceof ApiError && cause.problem?.detail !== undefined
              ? cause.problem.detail
              : tAll('mobile.settings.profile.loadFailed')
          }
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          testID="profile-load-failed"
        />
      );
    }
    return (
      <SkeletonGroup label={t('loading')} testID="profile-loading">
        <View style={styles.form}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={14} width="90%" />
          {SKELETON_FIELDS.map((row) => (
            <View key={row} style={styles.skeletonField}>
              <Skeleton height={14} width="30%" />
              <Skeleton height={row === 'bio' ? 96 : row === 'avatar' ? 80 : 44} radius="md" />
            </View>
          ))}
        </View>
      </SkeletonGroup>
    );
  }

  const profile = baseline;
  const readOnly = saving || !online || cachedOnly;
  const address = profilePath(profile.slug);
  const profileHref = { pathname: '/u/[slug]', params: { slug: profile.slug } } as const;

  function change(patch: Partial<ProfileDraft>): void {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
    // A confirmation that outlives the state it described is one that lies.
    setSaved(false);
  }

  function accept(answer: OwnProfile): void {
    setBaseline(answer);
    queryClient.setQueryData(queryKeys.ownProfile(), answer);
    // The account's name is on `GET /v1/me`, which the Me tab prints.
    void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
    // And `u/[slug]`, which "It is live at /u/{slug}" sends somebody to (its projects too).
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile(answer.slug) });
  }

  function describeFailure(cause: unknown): string {
    if (!(cause instanceof ApiError) || cause.problem === null) return t('unreachable');
    return cause.problem.detail ?? cause.problem.title ?? tAll('auth.failures.refusedDetail');
  }

  /** Under the field a refusal names, or above the form when it names none. */
  function placeRefusal(cause: unknown): void {
    const refusal = profileFieldRefusal(cause);
    if (refusal !== null && isProfileField(refusal.field)) {
      setFieldErrors({ [refusal.field]: refusal.message });
      setFailure(null);
    } else {
      setFailure(describeFailure(cause));
    }
  }

  async function submit(): Promise<void> {
    if (inFlight.current || !online || draft === null) return;
    inFlight.current = true;
    setSaving(true);
    setSaved(false);
    setFailure(null);
    setFieldErrors({});
    try {
      const answer = await saveOwnProfile(editFrom(profile, draft));
      accept(answer);
      setDraft(draftFrom(answer));
      setSaved(true);
    } catch (cause) {
      placeRefusal(cause);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  /** An uploaded picture is saved on its own, leaving the rest of the draft as it is. */
  async function saveAvatar(url: string): Promise<boolean> {
    setSaved(false);
    setFailure(null);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.avatarUrl;
      return next;
    });
    try {
      const answer = await saveOwnProfile({ avatarUrl: url });
      accept(answer);
      setDraft((current) =>
        current === null ? draftFrom(answer) : { ...current, avatarUrl: answer.avatarUrl ?? '' },
      );
      return true;
    } catch (cause) {
      placeRefusal(cause);
      return false;
    }
  }

  const locationList = locations.data;
  const locationsUnavailable =
    locationList === undefined && (locations.isError || locations.fetchStatus === 'paused');

  return (
    <SettingsCard
      title={t('heading')}
      intro={fillNodes(String(t.raw('liveAt')), {
        address: (
          <InlineLink href={profileHref} testID="profile-public-link">
            {address}
          </InlineLink>
        ),
      })}
      testID="profile-editor"
    >
      <Body>
        <Strong>{t('handleFixed', { slug: profile.slug })}</Strong> {t('handleWhy')}
      </Body>

      <View style={styles.form}>
        {failure === null ? null : (
          <InlineAlert
            variant="danger"
            title={t('saveFailedTitle')}
            description={failure}
            testID="profile-save-failed"
          />
        )}

        <Field
          label={t('name')}
          hint={t('nameHint', { max: PROFILE_NAME_MAX_CHARACTERS })}
          error={fieldErrors.name}
          required
        >
          {/* No maxLength: a silent cut is worse than the counter's "3 characters too many". */}
          <TextInput
            value={draft.name}
            onChangeText={(name) => change({ name })}
            autoComplete="name"
            textContentType="name"
            disabled={readOnly}
            testID="profile-name"
          />
          <CharacterCount
            count={characterCount(draft.name)}
            limit={PROFILE_NAME_MAX_CHARACTERS}
            testID="profile-name-count"
          />
        </Field>

        <Field
          label={t('bio')}
          hint={t('bioHint', { max: PROFILE_BIO_MAX_CHARACTERS })}
          error={fieldErrors.bio}
        >
          <Textarea
            value={draft.bio}
            onChangeText={(bio) => change({ bio })}
            numberOfLines={6}
            disabled={readOnly}
            testID="profile-bio"
          />
          <CharacterCount
            count={characterCount(draft.bio)}
            limit={PROFILE_BIO_MAX_CHARACTERS}
            testID="profile-bio-count"
          />
        </Field>

        <AvatarField
          url={draft.avatarUrl}
          name={draft.name}
          disabled={readOnly}
          error={fieldErrors.avatarUrl}
          onUrlChange={(avatarUrl) => change({ avatarUrl })}
          onUploaded={saveAvatar}
        />

        <Field label={t('website')} hint={t('websiteHint')} error={fieldErrors.websiteUrl}>
          <TextInput
            value={draft.websiteUrl}
            onChangeText={(websiteUrl) => change({ websiteUrl })}
            placeholder={t('websitePlaceholder')}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="url"
            textContentType="URL"
            disabled={readOnly}
            testID="profile-website"
          />
        </Field>

        {locationsUnavailable ? (
          // A sentence, not an empty picker: what the profile already says is still printed.
          <Field grouped label={t('location')} hint={t('locationHint')} error={fieldErrors.locationSlug}>
            <Body tone="tertiary" testID="profile-locations-unavailable">
              {profile.location === null
                ? t('locationsUnavailable')
                : t('locationsUnavailableWithValue', { place: profile.location.name })}
            </Body>
          </Field>
        ) : (
          <Field label={t('location')} hint={t('locationHint')} error={fieldErrors.locationSlug}>
            <Select
              options={[
                // Selectable, unlike a placeholder: this field must be clearable.
                { value: '', label: t('notSaying') },
                ...(locationList ?? (profile.location === null ? [] : [profile.location])).map(
                  (location) => ({ value: location.slug, label: location.name }),
                ),
              ]}
              value={draft.locationSlug}
              onChange={(locationSlug) => change({ locationSlug })}
              disabled={readOnly || locationList === undefined}
              testID="profile-location"
            />
          </Field>
        )}

        <SocialLinksField
          links={draft.socialLinks}
          disabled={readOnly}
          error={fieldErrors.socialLinks}
          onChange={(socialLinks) => change({ socialLinks })}
        />

        <View style={styles.submit}>
          <Pill
            label={saving ? t('saving') : t('save')}
            busy={saving}
            disabled={readOnly}
            onPress={() => void submit()}
            testID="profile-save"
          />
        </View>

        <View accessibilityLiveRegion="polite">
          {saved ? (
            <InlineAlert
              variant="success"
              title={t('savedTitle')}
              description={t('savedBody', { address })}
              politeness="off"
              testID="profile-saved"
            />
          ) : null}
        </View>
      </View>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing[5] },
  skeletonField: { gap: spacing[2] },
  submit: { alignItems: 'flex-start' },
});
