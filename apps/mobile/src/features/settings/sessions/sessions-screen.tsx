import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { deviceNameOf, type SessionSummary } from '@ideanest/account/sessions';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { queryKeys } from '../../../api/queries';
import {
  Body,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  InlineAlert,
  Meta,
  Pill,
  Skeleton,
  SkeletonGroup,
  Subheading,
  announce,
} from '../../../components/ui';
import { signOut } from '../../../lib/auth';
import { useOnline } from '../../../lib/connectivity';
import { pluralCategory, useT, type Translate } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { forgetPersistedCache } from '../../../lib/offline';
import { colors, spacing } from '../../../theme';
import { SettingsPage, useLeavingSettings } from '../settings-page';
import { listSessions, revokeSession } from './api';
import { SessionRow } from './session-row';

/** `settings/sessions` — "Devices", the web's `SessionsPanel` (#161). */
export function SessionsSettingsScreen() {
  const t = useT('settings.pages.sessions');
  return (
    <SettingsPage section="sessions" title={t('title')} intro={t('intro')}>
      <SessionsPanel />
    </SettingsPage>
  );
}

/**
 * A refusal as a sentence: 403 is the closure scheduled on the account, a problem the service
 * explained is its own explanation, and no answer at all is the connection.
 */
export function sessionsFailureMessage(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return t('settings.panels.sessions.deletionScheduled');
    return cause.problem?.detail ?? cause.problem?.title ?? t('auth.failures.refusedDetail');
  }
  return t('auth.failures.unreachableDetail');
}

function SessionsPanel() {
  const t = useT('settings.panels.sessions');
  const tAll = useT();
  const locale = useLocale();
  const online = useOnline();
  const router = useRouter();
  const queryClient = useQueryClient();
  const leave = useLeavingSettings();
  const heading = useRef<View>(null);
  const endingHere = useRef(false);

  const sessions = useQuery({
    queryKey: queryKeys.sessions(),
    queryFn: ({ signal }) => listSessions(signal),
    staleTime: 0,
  });

  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [endingOthers, setEndingOthers] = useState(false);

  // iOS has no live regions; Android's polite region below already speaks.
  useEffect(() => {
    if (notice !== null && Platform.OS === 'ios') announce(notice);
  }, [notice]);

  const rows = sessions.data ?? null;
  const others = (rows ?? []).filter((session) => !session.current);
  // Pinned per load, so every row's "ago" is measured from one instant.
  const now = new Date(sessions.dataUpdatedAt || Date.now());
  const nameCopy = { onPlatform: String(t.raw('row.onPlatform')), unknownDevice: t('row.unknownDevice') };
  const devices = (count: number): string =>
    fillPlaceholders(String(t.raw(`devices.${pluralCategory(locale, count)}`)), { count: String(count) });

  function markBusy(id: string, busy: boolean): void {
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function focusHeading(): void {
    if (heading.current !== null) AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
  }

  /**
   * This phone does not DELETE its own session: `signOut()` posts `/v1/auth/logout` with the
   * refresh token, which is what actually ends it, drops the push registration and the keychain;
   * then both caches go, as the Me tab's sign-out does, and the reader lands on home.
   *
   * <p>Without waiting for the logout request: once the keychain is empty this frame renders
   * nothing, and that request has no timeout. A ref, not state, guards a second tap — it lands
   * before the re-render that would carry `busy`.
   */
  async function endThisDevice(session: SessionSummary): Promise<void> {
    if (endingHere.current) return;
    endingHere.current = true;
    markBusy(session.id, true);
    setError(null);
    leave();
    try {
      await signOut({ waitForService: false });
    } finally {
      queryClient.clear();
      forgetPersistedCache();
      router.navigate('/');
    }
  }

  async function endOneDevice(session: SessionSummary): Promise<void> {
    if (!online || busyIds.has(session.id)) return;
    if (session.current) return endThisDevice(session);

    const name = deviceNameOf(session, nameCopy);
    markBusy(session.id, true);
    setError(null);
    setNotice(null);
    try {
      await revokeSession(session.id);
      queryClient.setQueryData<readonly SessionSummary[]>(queryKeys.sessions(), (previous) =>
        previous?.filter((row) => row.id !== session.id),
      );
      setNotice(fillPlaceholders(String(t.raw('signedOutDevice')), { name }));
      // The button that started this has gone; the list's heading is the nearest thing left.
      focusHeading();
    } catch (cause) {
      setError(sessionsFailureMessage(cause, tAll));
    } finally {
      markBusy(session.id, false);
    }
  }

  /** No batch endpoint: one DELETE per device, all settled, then the list as the service holds it. */
  async function endOtherDevices(): Promise<void> {
    if (endingOthers || !online) return;
    const targets = others;
    setEndingOthers(true);
    setError(null);
    setNotice(null);

    const results = await Promise.allSettled(targets.map((row) => revokeSession(row.id)));
    const failed = targets.filter((_, index) => results[index]?.status === 'rejected');
    const refusals = results.flatMap((result): unknown[] =>
      result.status === 'rejected' ? [result.reason] : [],
    );

    // Reload before reporting: what is on screen should be what the service now holds.
    await sessions.refetch();
    setEndingOthers(false);
    setConfirmOpen(false);

    if (failed.length === 0) {
      setNotice(fillPlaceholders(String(t.raw('signedOutDevices')), { devices: devices(targets.length) }));
    } else if (failed.length === targets.length && refusals.every((cause) => cause instanceof ApiError && cause.status === 403)) {
      setError(t('deletionScheduled'));
    } else {
      const partly = fillPlaceholders(String(t.raw('signedOutPartly')), {
        done: devices(targets.length - failed.length),
        failed: devices(failed.length),
      });
      const which = fillPlaceholders(String(tAll.raw('mobile.settings.sessions.stillSignedIn')), {
        devices: failed.map((row) => deviceNameOf(row, nameCopy)).join(', '),
      });
      setError(`${partly} ${which}`);
    }
    focusHeading();
  }

  const ready = rows !== null;

  return (
    <View style={styles.panel} testID="sessions-panel">
      <View style={styles.headingRow}>
        {/* One stop for the heading and its count, and the focus target once a row has gone. */}
        <View ref={heading} accessible accessibilityRole="header" style={styles.headingWords}>
          <Subheading>{t('heading')}</Subheading>
          {ready ? <Meta>{String(rows.length)}</Meta> : null}
        </View>
        {ready && others.length > 0 ? (
          <Pill
            label={t('signOutEverywhere')}
            variant="danger"
            size="sm"
            disabled={!online || endingOthers}
            onPress={() => setConfirmOpen(true)}
            testID="sessions-sign-out-others"
          />
        ) : null}
      </View>

      {notice === null ? null : (
        <InlineAlert variant="success" politeness="polite" description={notice} testID="sessions-notice" />
      )}
      {error === null ? null : (
        <InlineAlert variant="danger" title={t('errorTitle')} description={error} testID="sessions-error" />
      )}

      {ready ? (
        rows.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={tAll('mobile.settings.sessions.emptyBody')}
            action={<Pill label={t('tryAgain')} variant="ghost" size="sm" onPress={() => void sessions.refetch()} />}
            testID="sessions-empty"
          />
        ) : (
          <Card size="md">
            {rows.map((session, index) => (
              <View key={session.id} style={index === 0 ? undefined : styles.divided}>
                <SessionRow
                  session={session}
                  now={now}
                  busy={busyIds.has(session.id)}
                  disabled={!online || busyIds.has(session.id) || endingOthers}
                  onSignOut={(row) => void endOneDevice(row)}
                />
              </View>
            ))}
          </Card>
        )
      ) : sessions.isError && online ? (
        <ErrorState
          title={t('errorTitle')}
          description={sessionsFailureMessage(sessions.error, tAll)}
          onRetry={() => void sessions.refetch()}
          retrying={sessions.isFetching}
          testID="sessions-failed"
        />
      ) : !online ? (
        <Body testID="sessions-offline-empty">{tAll('mobile.settings.sessions.offlineEmpty')}</Body>
      ) : (
        <SkeletonGroup label={t('loading')} testID="sessions-loading">
          <Card size="md">
            {[0, 1, 2].map((row) => (
              <View key={row} style={[styles.skeletonRow, row === 0 ? undefined : styles.divided]}>
                <Skeleton width={36} height={36} radius="md" />
                <View style={styles.skeletonWords}>
                  <Skeleton width="40%" height={16} />
                  <Skeleton width="65%" height={14} />
                </View>
              </View>
            ))}
          </Card>
        </SkeletonGroup>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!endingOthers) setConfirmOpen(false);
        }}
        title={t('confirmTitle')}
        description={fillPlaceholders(String(t.raw('confirmDescription')), { devices: devices(others.length) })}
        showClose={false}
        dismissOnScrim={false}
        testID="sessions-confirm"
        footer={
          <>
            <Pill
              label={
                endingOthers
                  ? t('signingOutAll')
                  : fillPlaceholders(String(t.raw('signOutCount')), { devices: devices(others.length) })
              }
              variant="danger"
              fullWidth
              busy={endingOthers}
              disabled={!online}
              onPress={() => void endOtherDevices()}
              testID="sessions-confirm-sign-out"
            />
            <Pill
              label={t('cancel')}
              variant="ghost"
              fullWidth
              disabled={endingOthers}
              onPress={() => setConfirmOpen(false)}
              testID="sessions-confirm-cancel"
            />
          </>
        }
      >
        <Body>{t('confirmBody')}</Body>
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing[4] },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  headingWords: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  skeletonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[4], paddingVertical: spacing[4] },
  skeletonWords: { flex: 1, gap: spacing[2] },
});
