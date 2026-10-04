import { useEffect, useRef, useState, type Ref } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../../icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import {
  CATEGORIES,
  CHANNELS,
  modesFor,
  type DeliveryMode,
  type NotificationCategory,
  type NotificationChannel,
  type PreferenceSwitch,
} from '@ideanest/account/notifications';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { queryKeys } from '../../../api/queries';
import {
  Body,
  Caption,
  Card,
  CardTitle,
  ErrorState,
  Icon,
  InlineAlert,
  Meta,
  Pill,
  Radio,
  RadioGroup,
  Sheet,
  Skeleton,
  SkeletonGroup,
  Subheading,
  announce,
  useFocusRing,
} from '../../../components/ui';
import { useOnline } from '../../../lib/connectivity';
import { useT, type Translate } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { registerForPush } from '../../../lib/push';
import { colors, font, fontSize, lineHeight, size, spacing } from '../../../theme';
import { InlineLink, SettingsPage, Strong } from '../settings-page';
import { listPreferences, updatePreference } from './api';
import { usePushPermission } from './push-permission';

/** `settings/notifications` — the web's `PreferencesPanel` (#161, §4.10). */
export function NotificationSettingsScreen() {
  const t = useT('settings.pages.notifications');
  return (
    <SettingsPage
      section="notifications"
      title={t('title')}
      intro={t.rich('intro', {
        b: (chunks) => <Strong>{chunks}</Strong>,
        inbox: (chunks) => <InlineLink href="/notifications">{chunks}</InlineLink>,
      })}
    >
      <PreferencesPanel />
    </SettingsPage>
  );
}

function keyOf(category: NotificationCategory, channel: NotificationChannel): string {
  return `${category}:${channel}`;
}

/** A refusal as a sentence, the web's `messageFor` with the app's own words for a conflict. */
export function preferencesFailureMessage(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError) {
    if (cause.status === 429) return t('account.notifications.preferences.tooManyChanges');
    if (cause.status === 409) return t('mobile.settings.notifications.conflict');
    return cause.problem?.detail ?? cause.problem?.title ?? t('account.notifications.preferences.refused');
  }
  return t('account.notifications.preferences.unreachable');
}

/**
 * Every switch is drawn from the response: whether it may change (`changeable`) and whether a
 * digest is offered (`digestOffered`) are the service's answers, never restated here. One change,
 * one request — the endpoint is all-or-nothing, so saving each change as it is made keeps a
 * refusal on the one control that would not move.
 */
function PreferencesPanel() {
  const t = useT('account.notifications');
  const tAll = useT();
  const locale = useLocale();
  const online = useOnline();
  const queryClient = useQueryClient();
  const { permission, refresh } = usePushPermission();

  const preferences = useQuery({
    queryKey: queryKeys.notificationPreferences(),
    queryFn: ({ signal }) => listPreferences(signal),
    staleTime: 0,
  });

  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PreferenceSwitch | null>(null);
  // The row that opened the sheet keeps the ref after it closes, so focus can go back to it.
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const opener = useRef<View>(null);
  const [pushFailed, setPushFailed] = useState(false);
  const latestWrite = useRef(0);
  const writesInFlight = useRef(0);
  const staleWrite = useRef(false);

  useEffect(() => {
    if (notice !== null && Platform.OS === 'ios') announce(notice);
  }, [notice]);

  const rows = preferences.data ?? null;
  const stored = (rows ?? []).filter((preference) => preference.stored).length;

  const categoryLabel = (category: NotificationCategory) => t(`category.${category}`);
  const channelLabel = (channel: NotificationChannel) => t(`channel.${channel}`);
  const modeLabel = (mode: DeliveryMode) => t(`mode.${mode}`);
  const cellLabel = (preference: PreferenceSwitch) =>
    fillPlaceholders(String(tAll.raw('mobile.settings.notifications.cellLabel')), {
      category: categoryLabel(preference.category),
      channel: channelLabel(preference.channel),
    });

  function markBusy(key: string, busy: boolean): void {
    setBusyKeys((previous) => {
      const next = new Set(previous);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function change(preference: PreferenceSwitch, mode: DeliveryMode): Promise<void> {
    const key = keyOf(preference.category, preference.channel);
    if (!online || busyKeys.has(key)) return;
    markBusy(key, true);
    setError(null);
    setNotice(null);

    /*
     * Rows save independently, so two PATCHes can be in flight and each answers the WHOLE table.
     * Only the latest request's answer is adopted; an older one arriving after it would put the
     * newer change back. A discarded answer means the cache may be behind, so the table is read
     * again once nothing is in flight.
     */
    const ticket = ++latestWrite.current;
    writesInFlight.current += 1;
    try {
      const page = await updatePreference({
        category: preference.category,
        channel: preference.channel,
        mode,
      });
      await queryClient.cancelQueries({ queryKey: queryKeys.notificationPreferences() });
      if (ticket === latestWrite.current) {
        queryClient.setQueryData(queryKeys.notificationPreferences(), page);
      } else {
        staleWrite.current = true;
      }
      const saved = fillPlaceholders(String(t.raw('preferences.saved')), {
        category: categoryLabel(preference.category),
        channel: channelLabel(preference.channel).toLocaleLowerCase(locale),
        mode: modeLabel(mode).toLocaleLowerCase(locale),
      });
      setNotice(fillPlaceholders(String(t.raw('preferences.savedNotice')), { change: saved }));
    } catch (cause) {
      // Nothing is written back, so the row still shows what the service last confirmed.
      setError(preferencesFailureMessage(cause, tAll));
      if (cause instanceof ApiError && cause.status === 409) void preferences.refetch();
      return;
    } finally {
      markBusy(key, false);
      writesInFlight.current -= 1;
      if (writesInFlight.current === 0 && staleWrite.current) {
        staleWrite.current = false;
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences() });
      }
    }

    /*
     * Asked at the moment it means something: a Push switch has just been turned on and the
     * phone has not allowed IdeyaNest to notify. A refusal keeps the server's preference; the
     * notice at the top then explains why nothing will arrive, with the way to the settings.
     */
    if (preference.channel === 'PUSH' && mode !== 'OFF' && permission !== 'granted') {
      setPushFailed(false);
      try {
        const outcome = await registerForPush();
        const now = await refresh();
        if (outcome.status === 'failed') setPushFailed(true);
        // iOS has no live regions, so the notice appearing is said out loud here, once.
        if (now === 'denied' && Platform.OS === 'ios') {
          announce(tAll('mobile.settings.notifications.pushOffTitle'), { assertive: true });
        }
      } catch {
        setPushFailed(true);
      }
    }
  }

  return (
    <View style={styles.panel} testID="preferences-panel">
      {permission === 'denied' ? (
        <InlineAlert
          variant="warning"
          politeness="polite"
          title={tAll('mobile.settings.notifications.pushOffTitle')}
          description={tAll('mobile.settings.notifications.pushOffBody')}
          action={
            <Pill
              label={tAll('mobile.settings.notifications.openSettings')}
              variant="outline"
              size="sm"
              onPress={() => void Linking.openSettings()}
              testID="preferences-open-settings"
            />
          }
          testID="preferences-push-off"
        />
      ) : null}

      {pushFailed ? (
        <InlineAlert
          variant="warning"
          description={tAll('mobile.settings.notifications.pushFailed')}
          testID="preferences-push-failed"
        />
      ) : null}

      <View accessible accessibilityRole="header" style={styles.headingRow}>
        <Subheading>{t('preferences.heading')}</Subheading>
        {rows !== null && stored === 0 ? <Meta>{t('preferences.defaults')}</Meta> : null}
      </View>

      {notice === null ? null : (
        <InlineAlert variant="success" politeness="polite" description={notice} testID="preferences-notice" />
      )}
      {error === null ? null : (
        <InlineAlert
          variant="danger"
          title={t('preferences.saveFailedTitle')}
          description={error}
          testID="preferences-error"
        />
      )}

      {rows !== null ? (
        CATEGORIES.map((category) => {
          const row = rows.filter((preference) => preference.category === category);
          if (row.length === 0) return null;
          return (
            <Card key={category} size="md" testID={`preferences-${category}`}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <CardTitle accessibilityRole="header">{categoryLabel(category)}</CardTitle>
                  <Caption>{t(`categoryDescription.${category}`)}</Caption>
                </View>
                {CHANNELS.map((channel) => {
                  const preference = row.find((entry) => entry.channel === channel);
                  if (preference === undefined) return null;
                  const key = keyOf(category, channel);
                  return (
                    <PreferenceRow
                      key={channel}
                      ref={openedKey === key ? opener : undefined}
                      preference={preference}
                      channelLabel={channelLabel(channel)}
                      modeLabel={modeLabel(preference.mode)}
                      accessibleName={cellLabel(preference)}
                      busy={busyKeys.has(key)}
                      disabled={!online || !preference.changeable || busyKeys.has(key)}
                      onPress={() => {
                        setOpenedKey(key);
                        setEditing(preference);
                      }}
                    />
                  );
                })}
              </View>
            </Card>
          );
        })
      ) : preferences.isError && online ? (
        <ErrorState
          title={t('inbox.errorTitle')}
          description={preferencesFailureMessage(preferences.error, tAll)}
          onRetry={() => void preferences.refetch()}
          retrying={preferences.isFetching}
          testID="preferences-failed"
        />
      ) : !online ? (
        <Body testID="preferences-offline-empty">{tAll('mobile.settings.notifications.offlineEmpty')}</Body>
      ) : (
        <SkeletonGroup label={t('preferences.loading')} testID="preferences-loading">
          <View style={styles.panel}>
            {[0, 1, 2].map((card) => (
              <Card key={card} size="md">
                <View style={styles.card}>
                  <Skeleton width="30%" height={16} />
                  <Skeleton height={size.touchTarget} />
                  <Skeleton height={size.touchTarget} />
                  <Skeleton height={size.touchTarget} />
                </View>
              </Card>
            ))}
          </View>
        </SkeletonGroup>
      )}

      <Sheet
        surface="dark"
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === null ? '' : cellLabel(editing)}
        returnFocusTo={opener}
        testID="preferences-sheet"
      >
        {editing === null ? null : (
          <RadioGroup
            label={cellLabel(editing)}
            value={editing.mode}
            onChange={(next) => {
              const chosen = modesFor(editing.digestOffered).find((mode) => mode === next);
              const target = editing;
              setEditing(null);
              if (chosen !== undefined && chosen !== target.mode) void change(target, chosen);
            }}
          >
            {modesFor(editing.digestOffered).map((mode) => (
              <Radio key={mode} value={mode} label={modeLabel(mode)} />
            ))}
          </RadioGroup>
        )}
      </Sheet>
    </View>
  );
}

function PreferenceRow({
  ref,
  preference,
  channelLabel,
  modeLabel,
  accessibleName,
  busy,
  disabled,
  onPress,
}: {
  readonly ref?: Ref<View>;
  readonly preference: PreferenceSwitch;
  readonly channelLabel: string;
  readonly modeLabel: string;
  readonly accessibleName: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const t = useT('account.notifications');
  const tAll = useT();
  const { ring, onFocus, onBlur } = useFocusRing();
  const unsaved = preference.changeable && !preference.stored;
  const reason = preference.changeable
    ? null
    : t(preference.category === 'SECURITY' ? 'mandatorySecurity' : 'mandatoryOther');
  const value = [modeLabel, unsaved ? t('preferences.default') : null].filter(Boolean).join(', ');

  return (
    <View style={styles.cell}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={accessibleName}
        accessibilityValue={{ text: value }}
        accessibilityHint={disabled ? undefined : tAll('mobile.settings.notifications.chooseHint')}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={onPress}
        onFocus={onFocus}
        onBlur={onBlur}
        style={[styles.row, ring]}
        testID={`preference-${preference.category}-${preference.channel}`}
      >
        <Text style={styles.channel}>{channelLabel}</Text>
        <View style={styles.value}>
          <Text style={[styles.mode, disabled ? styles.muted : null]}>{modeLabel}</Text>
          {unsaved ? <Text style={styles.muted}>{t('preferences.default')}</Text> : null}
        </View>
        {preference.changeable ? <Icon icon={Glyphs.ArrowRight2} size={16} color={colors.textTertiary} /> : null}
      </Pressable>
      {reason === null ? null : <Caption>{reason}</Caption>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing[4] },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: spacing[2] },
  card: { gap: spacing[3] },
  cardHeader: { gap: spacing[1] },
  cell: { gap: spacing[1] },
  row: {
    minHeight: size.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  channel: { ...font.medium, flex: 1, color: colors.textPrimary, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  value: { alignItems: 'flex-end' },
  mode: { ...font.regular, color: colors.textPrimary, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  muted: { ...font.regular, color: colors.textTertiary, fontSize: fontSize.xs, lineHeight: lineHeight.small },
});
