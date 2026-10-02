import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { fillNodes } from '@ideanest/messages/placeholders';
import { Download } from 'lucide-react-native';
import { queryKeys } from '../../../api/queries';
import {
  Body,
  Card,
  Checkbox,
  ErrorState,
  Field,
  InlineAlert,
  PasswordInput,
  Pill,
  Skeleton,
  SkeletonGroup,
  Subheading,
  Switch,
} from '../../../components/ui';
import { ACCOUNT_KEYS, useMe } from '../../../lib/account';
import { useOnline } from '../../../lib/connectivity';
import { formatDateTime, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { colors, spacing } from '../../../theme';
import { SettingsCard, SettingsPage, Strong } from '../settings-page';
import {
  EXPORT_FILENAME,
  cancelDeletion,
  fetchAccountExport,
  probeProfileVisibility,
  requestDeletion,
  setProfileVisibility,
  type ProfileVisibility,
} from './api';
import { ExportWriteError, canShareFiles, shareAccountExport } from './share-export';

/**
 * `settings/privacy` — the web's `/settings/privacy` (#161): who can see the profile, a copy of
 * the account, and closing it. The order is the web's and it is the argument: the reversible
 * switch first, then the export, then the closure the export makes survivable.
 */
export function PrivacySettingsScreen() {
  const t = useT('settings.pages.privacy');
  return (
    <SettingsPage section="privacy" title={t('title')} intro={t('intro')} testID="privacy-settings">
      <PrivacyPanels />
    </SettingsPage>
  );
}

function PrivacyPanels() {
  const t = useT('mobile.settings.privacy');
  const me = useMe();

  if (me.data === undefined) {
    if (me.isFetching) return <PrivacySkeleton label={t('loading')} />;
    // Failed, or never asked because the app lock has not been opened: "Try again" asks.
    return (
      <ErrorState
        title={t('loadFailedTitle')}
        description={t('loadFailedBody')}
        onRetry={() => void me.refetch()}
        testID="privacy-load-failed"
      />
    );
  }
  // The service said nobody is signed in; the shell takes this phone to sign-in.
  if (me.data === null) return null;

  return (
    <>
      <VisibilityPanel slug={me.data.slug ?? null} />
      <DataExportPanel />
      <AccountClosurePanel scheduledFor={me.data.deletionScheduledAt ?? null} />
    </>
  );
}

function PrivacySkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonGroup label={label} testID="privacy-loading">
      <View style={styles.skeletons}>
        {[0, 1, 2].map((index) => (
          <Card key={index} size="md">
            <View style={styles.card}>
              <Skeleton width="50%" height={20} />
              <Skeleton />
              <Skeleton width="80%" />
              <Skeleton width={160} height={40} radius="lg" />
            </View>
          </Card>
        ))}
      </View>
    </SkeletonGroup>
  );
}

/** What a refusal says, or the panel's own sentence when the service gave none. */
function describeFailure(
  cause: unknown,
  copy: { readonly rateLimited: string; readonly refused: string; readonly unreachable: string },
): string {
  if (cause instanceof ApiError) {
    if (cause.status === 429) return cause.problem?.detail ?? copy.rateLimited;
    return cause.problem?.detail ?? cause.problem?.title ?? copy.refused;
  }
  return copy.unreachable;
}

type Position = ProfileVisibility | 'unknown' | 'loading';

/**
 * The web's `ProfileVisibilityPanel`. There is no read for this setting, so the switch shows
 * what a stranger is answered at `/v1/users/{slug}` — and when that cannot be read it is
 * disabled and says so, rather than guessing a position and then writing it.
 */
function VisibilityPanel({ slug }: { readonly slug: string | null }) {
  const t = useT('profile.editor.visibility');
  const tAll = useT();
  const router = useRouter();
  const online = useOnline();
  const queryClient = useQueryClient();
  const key = queryKeys.profileVisibility(slug ?? '');

  const probe = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => probeProfileVisibility(slug ?? '', signal),
    enabled: slug !== null,
    staleTime: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const position: Position =
    probe.data === 'PUBLIC' || probe.data === 'PRIVATE'
      ? probe.data
      : slug === null || probe.data === null || probe.isError
        ? 'unknown'
        : 'loading';
  const known = position === 'PUBLIC' || position === 'PRIVATE';

  async function change(next: boolean): Promise<void> {
    if (saving || !online || !known || slug === null) return;
    const wanted: ProfileVisibility = next ? 'PUBLIC' : 'PRIVATE';
    const previous = position;

    setSaving(true);
    setError(null);
    await queryClient.cancelQueries({ queryKey: key });
    // Optimistic: two round trips is long enough for a switch behind the finger to feel broken.
    queryClient.setQueryData(key, wanted);

    try {
      await setProfileVisibility(wanted);
    } catch (cause) {
      queryClient.setQueryData(key, previous);
      setError(
        describeFailure(cause, {
          rateLimited: t('refused'),
          refused: t('refused'),
          unreachable: t('unreachable'),
        }),
      );
      setSaving(false);
      return;
    }

    try {
      // 204 carries nothing, so the only evidence the write took is asking as a stranger again.
      await queryClient.fetchQuery({
        queryKey: key,
        queryFn: ({ signal }) => probeProfileVisibility(slug, signal),
        staleTime: 0,
      });
    } catch {
      // Written, but not confirmed: an unknown position, not the one we hoped for.
      queryClient.setQueryData(key, null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard title={t('heading')} intro={t('intro')} testID="privacy-visibility">
      <Switch
        label={t('toggle')}
        // The state in words beside the switch, so colour never carries it alone.
        description={position === 'PUBLIC' ? t('public') : position === 'PRIVATE' ? t('hidden') : undefined}
        value={position === 'PUBLIC'}
        onValueChange={(next) => void change(next)}
        disabled={!known || saving || !online}
        testID="privacy-visibility-switch"
      />
      {position === 'loading' ? <Body tone="tertiary">{t('checking')}</Body> : null}
      {position === 'unknown' ? (
        <InlineAlert
          variant="warning"
          title={t('unknownTitle')}
          description={tAll('mobile.settings.privacy.visibility.unknownBody')}
          action={
            slug === null ? undefined : (
              <Pill
                label={tAll('common.tryAgain')}
                variant="ghost"
                size="sm"
                disabled={!online}
                busy={probe.isFetching}
                onPress={() => void probe.refetch()}
                testID="privacy-visibility-retry"
              />
            )
          }
          testID="privacy-visibility-unknown"
        />
      ) : null}
      {error === null ? null : (
        <InlineAlert
          variant="danger"
          title={t('failedTitle')}
          description={error}
          onDismiss={() => setError(null)}
          testID="privacy-visibility-failed"
        />
      )}
      {position === 'PUBLIC' && slug !== null ? (
        <View style={styles.start}>
          <Pill
            label={t('seeAsVisitor')}
            variant="ghost"
            onPress={() => router.push({ pathname: '/u/[slug]', params: { slug } })}
            testID="privacy-visibility-profile"
          />
        </View>
      ) : null}
    </SettingsCard>
  );
}

type ExportState = 'idle' | 'busy' | 'shared';

/**
 * The web's `DataExportPanel`, through the share sheet instead of a download: the file is
 * written to the cache directory, handed over, and deleted when the sheet closes. A 429 is
 * shown rather than retried — the allowance is the account's, and spending it on the
 * reader's behalf would be spending somebody else's.
 */
function DataExportPanel() {
  const t = useT('settings.panels.export');
  const tAll = useT();
  const online = useOnline();
  const [state, setState] = useState<ExportState>('idle');
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    if (state === 'busy' || !online) return;
    setState('busy');
    setError(null);
    try {
      if (!(await canShareFiles())) {
        setError(tAll('mobile.settings.privacy.export.unavailable'));
        setState('idle');
        return;
      }
      await shareAccountExport(await fetchAccountExport());
      setState('shared');
    } catch (cause) {
      setError(
        cause instanceof ExportWriteError
          ? tAll('mobile.settings.privacy.export.writeFailed')
          : describeFailure(cause, {
              rateLimited: t('rateLimited'),
              refused: t('refused'),
              unreachable: tAll('auth.failures.unreachableDetail'),
            }),
      );
      setState('idle');
    }
  }

  const busy = state === 'busy';
  return (
    <SettingsCard
      title={t('heading')}
      intro={tAll('mobile.settings.privacy.export.intro')}
      testID="privacy-export"
    >
      {error === null ? null : (
        <InlineAlert
          variant="danger"
          title={t('errorTitle')}
          description={error}
          testID="privacy-export-failed"
        />
      )}
      {state === 'shared' ? (
        <View style={styles.notice} testID="privacy-export-shared" accessibilityLiveRegion="polite">
          <Subheading>{tAll('mobile.settings.privacy.export.sharedTitle')}</Subheading>
          <Body>
            {fillNodes(String(tAll.raw('mobile.settings.privacy.export.sharedBody')), {
              filename: <Strong>{EXPORT_FILENAME}</Strong>,
            })}
          </Body>
        </View>
      ) : null}
      <View style={styles.start}>
        <Pill
          label={busy ? t('preparing') : t('download')}
          iconLeft={Download}
          busy={busy}
          disabled={!online}
          onPress={() => void download()}
          testID="privacy-export-download"
        />
      </View>
    </SettingsCard>
  );
}

/**
 * The web's `AccountClosurePanel`. Closing takes the password; keeping the account takes only
 * the session — the safe direction is not obstructed for somebody whose account was closed by
 * someone else. The schedule is read back from `GET /v1/me`, not held here, so every screen
 * agrees on it.
 */
function AccountClosurePanel({ scheduledFor }: { readonly scheduledFor: string | null }) {
  const t = useT('settings.panels.closure');
  const tAll = useT();
  const locale = useLocale();
  const online = useOnline();
  const queryClient = useQueryClient();

  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  const failureCopy = {
    rateLimited: t('rateLimited'),
    refused: tAll('auth.failures.refusedDetail'),
    unreachable: tAll('auth.failures.unreachableDetail'),
  };

  async function close(): Promise<void> {
    if (busy || !online || !understood || password === '') return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await requestDeletion(password);
      setPassword('');
      if (outcome === 'already-gone') {
        // Nothing was closed, and saying "done" would report a deletion that did not happen.
        setGone(true);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
    } catch (cause) {
      setError(describeFailure(cause, failureCopy));
    } finally {
      setBusy(false);
    }
  }

  async function keep(): Promise<void> {
    if (busy || !online) return;
    setBusy(true);
    setError(null);
    try {
      await cancelDeletion();
      await queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
      setUnderstood(false);
    } catch (cause) {
      setError(describeFailure(cause, failureCopy));
    } finally {
      setBusy(false);
    }
  }

  return (
    // `--surface-2` with a `--danger` left rule; the heading and the button say what this is.
    <Card size="md" style={styles.danger} testID="privacy-closure">
      <View style={styles.card}>
        <Subheading accessibilityRole="header">{t('heading')}</Subheading>
        {error === null ? null : (
          <InlineAlert
            variant="danger"
            title={tAll('auth.failures.refusedTitle')}
            description={error}
            testID="privacy-closure-failed"
          />
        )}
        {gone ? (
          <InlineAlert
            variant="warning"
            title={t('goneTitle')}
            description={t('goneBody')}
            testID="privacy-closure-gone"
          />
        ) : null}
        {scheduledFor !== null ? (
          <View style={styles.form} testID="privacy-closure-scheduled">
            <InlineAlert
              variant="warning"
              title={t('scheduledTitle')}
              description={t('scheduledBody', { date: formatDateTime(scheduledFor, locale) })}
            />
            <View style={styles.start}>
              <Pill
                label={busy ? t('cancelling') : t('keep')}
                busy={busy}
                disabled={!online}
                onPress={() => void keep()}
                testID="privacy-closure-keep"
              />
            </View>
          </View>
        ) : (
          <View style={styles.form}>
            <Body>{t('notImmediate')}</Body>
            <Body>{t('recordsKept')}</Body>
            <Field label={t('currentPassword')} required>
              <PasswordInput
                value={password}
                onChangeText={setPassword}
                autoComplete="current-password"
                textContentType="password"
                disabled={busy}
                testID="privacy-closure-password"
              />
            </Field>
            <Checkbox
              label={t('understood')}
              checked={understood}
              onChange={setUnderstood}
              disabled={busy}
              testID="privacy-closure-understood"
            />
            <View style={styles.start}>
              <Pill
                label={busy ? t('scheduling') : t('close')}
                variant="danger"
                busy={busy}
                disabled={!online || !understood || password === ''}
                onPress={() => void close()}
                testID="privacy-closure-submit"
              />
            </View>
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  skeletons: { gap: spacing[6] },
  card: { gap: spacing[4] },
  form: { gap: spacing[5] },
  notice: { gap: spacing[1] },
  start: { alignItems: 'flex-start' },
  danger: { borderLeftWidth: 2, borderLeftColor: colors.danger },
});
