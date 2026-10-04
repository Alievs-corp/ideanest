import { StyleSheet, View } from 'react-native';
import { Glyphs } from '../../../icons';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import {
  browserOf,
  deviceNameOf,
  locationOf,
  platformOf,
  type SessionSummary,
} from '@ideanest/account/sessions';
import { Body, CardTitle, Icon, Pill, Tag } from '../../../components/ui';
import { useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { colors, radius, spacing } from '../../../theme';
import { relativeTime } from './relative-time';

/**
 * One device — the web's `SessionRow` (#161). The current device is marked with a word, not a
 * colour and not lime: "this device" is where you are, not something to hurry about.
 */
export function SessionRow({
  session,
  now,
  busy,
  disabled,
  onSignOut,
}: {
  readonly session: SessionSummary;
  /** Fixed by the list, so every row agrees on "ago". */
  readonly now: Date;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onSignOut: (session: SessionSummary) => void;
}) {
  const t = useT('settings.panels.sessions.row');
  const locale = useLocale();
  const copy = { onPlatform: String(t.raw('onPlatform')), unknownDevice: t('unknownDevice') };

  const name = deviceNameOf(session, copy);
  const platform = platformOf(session.userAgent);
  const browser = browserOf(session.userAgent);
  const address = locationOf(session);
  const isPhone = platform === 'Android' || platform === 'iOS';

  // A label of the client's own hides the browser; put it back as detail, as the web does.
  const agent = session.deviceLabel?.trim()
    ? browser && platform
      ? fillPlaceholders(copy.onPlatform, { browser, platform })
      : (browser ?? platform ?? null)
    : null;
  const detail = [agent, address].filter(Boolean).join(' · ');

  const label = session.current
    ? busy
      ? t('signingOutThisLabel')
      : t('signOutThisLabel')
    : fillPlaceholders(String(t.raw(busy ? 'signingOutLabel' : 'signOutLabel')), { device: name });

  return (
    <View style={styles.row} testID={`session-${session.id}`}>
      <View
        style={styles.icon}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon icon={isPhone ? Glyphs.Mobile : Glyphs.Monitor} size={18} color={colors.textSecondary} />
      </View>
      <View style={styles.words}>
        <View style={styles.nameLine}>
          <CardTitle>{name}</CardTitle>
          {session.current ? <Tag label={t('thisDevice')} /> : null}
        </View>
        <Body>{detail === '' ? t('noDetails') : detail}</Body>
        <Body>
          {fillPlaceholders(String(t.raw('lastActive')), {
            seen: relativeTime(session.lastSeenAt, now, locale),
            created: relativeTime(session.createdAt, now, locale),
          })}
        </Body>
        <View style={styles.action}>
          <Pill
            label={busy ? t('signingOut') : t('signOut')}
            accessibilityLabel={label}
            variant="ghost"
            size="sm"
            busy={busy}
            disabled={disabled}
            onPress={() => onSignOut(session)}
            testID={`session-sign-out-${session.id}`}
          />
        </View>
      </View>
    </View>
  );
}

const ICON_SIZE = 36;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[4], paddingVertical: spacing[4] },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: radius.md,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { flex: 1, minWidth: 0, gap: spacing[1] },
  nameLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  action: { alignItems: 'flex-start', paddingTop: spacing[2] },
});
