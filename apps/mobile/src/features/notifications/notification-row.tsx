import { memo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Locale } from '@ideanest/messages';
import {
  categoryLabel,
  describeNotification,
  isUnread,
  type InboxNotification,
  type NotificationsCopy,
} from '@ideanest/account/inbox';
import { Pill, PressableScale, Tag, TONES, useSurface } from '../../components/ui';
import { BLOCK, blockSurface } from '../../components/ui/surface';
import { formatDateTime, useT } from '../../lib/i18n';
import { font, fontSize, lineHeight, radius, size, spacing, tint } from '../../theme';
import { relativeTime } from '../settings/sessions/relative-time';

export interface NotificationRowProps {
  readonly notification: InboxNotification;
  /** Pinned per load, so every row's "ago" is measured from one instant. */
  readonly now: Date;
  readonly locale: Locale;
  readonly copy: NotificationsCopy;
  readonly busy: boolean;
  /** Offline: mark-read waits for a connection, and says so in its hint. */
  readonly online: boolean;
  readonly onOpen: (notification: InboxNotification, href: string) => void;
  readonly onMarkRead: (notification: InboxNotification) => void;
}

/**
 * One row of the inbox — the web's `NotificationRow` (#88), on the inbox's white sheet (#160).
 *
 * <ul>
 *   <li><strong>Unread is a word as well as a dot.</strong> The dot is decorative; the row says
 *       `inbox.unreadWord` in visible text, so colour never carries it alone.</li>
 *   <li>A row with a destination is pressable as a whole (a link), and opening it marks it read.
 *       A row without one is plain text, never a disabled button.</li>
 *   <li>The time is relative; the exact time is the accessibility hint, and a long press on the
 *       time shows it in place.</li>
 *   <li>Mark as read is a sibling of the link, so a screen reader reaches each on its own.</li>
 * </ul>
 */
export const NotificationRow = memo(function NotificationRow({
  notification,
  now,
  locale,
  copy,
  busy,
  online,
  onOpen,
  onMarkRead,
}: NotificationRowProps) {
  const t = useT('account.notifications.inbox');
  const tAll = useT();
  const surface = useSurface();
  const tones = TONES[surface];
  const block = BLOCK[blockSurface(surface)];
  const [exact, setExact] = useState(false);

  const view = describeNotification(notification, copy, locale);
  const unread = isUnread(notification);
  const category = categoryLabel(notification.category, copy);
  const relative = relativeTime(notification.occurredAt, now, locale);
  const exactTime = formatDateTime(notification.occurredAt, locale);
  const spoken = [view.headline, category, relative, unread ? t('unreadWord') : null]
    .filter((part): part is string => part !== null)
    .join(', ');

  const body = (
    <>
      <View
        style={[styles.dot, { backgroundColor: unread ? tones.primary : tint(tones.primary, 0.16) }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={styles.text}>
        <Text style={[styles.headline, { color: tones.primary }]}>{view.headline}</Text>
        <View style={styles.meta}>
          <Tag label={category} />
          <Text
            style={[styles.time, { color: tones.secondary }]}
            onLongPress={() => setExact((shown) => !shown)}
            testID={`notification-time-${notification.id}`}
          >
            {exact ? exactTime : relative}
          </Text>
          {unread ? <Text style={[styles.unread, { color: tones.primary }]}>{t('unreadWord')}</Text> : null}
        </View>
      </View>
    </>
  );

  let main: ReactNode;
  if (view.href === null) {
    main = (
      <View
        accessible
        accessibilityLabel={spoken}
        accessibilityHint={exactTime}
        style={[styles.main, styles.content]}
        testID={`notification-${notification.id}`}
      >
        {body}
      </View>
    );
  } else {
    const href = view.href;
    main = (
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={spoken}
        accessibilityHint={exactTime}
        onPress={() => onOpen(notification, href)}
        style={styles.main}
        contentStyle={({ pressed }) => [
          styles.content,
          styles.link,
          pressed && { backgroundColor: block.pressed },
        ]}
        testID={`notification-${notification.id}`}
      >
        {body}
      </PressableScale>
    );
  }

  return (
    <View style={styles.row}>
      {main}
      {unread ? (
        <View style={styles.trailing}>
          <Pill
            variant="ghost"
            size="sm"
            label={busy ? t('marking') : t('markRead')}
            accessibilityLabel={`${t('markRead')}: ${view.headline}`}
            accessibilityHint={online ? undefined : tAll('mobile.notifications.offline')}
            busy={busy}
            disabled={!online}
            onPress={() => onMarkRead(notification)}
            testID={`notification-mark-${notification.id}`}
          />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  main: { flex: 1 },
  content: {
    minHeight: size.touchTarget,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  link: { paddingHorizontal: spacing[2], marginHorizontal: -spacing[2], borderRadius: radius.md },
  dot: { width: spacing[2], height: spacing[2], borderRadius: radius.full, marginTop: spacing[2] },
  text: { flex: 1, gap: spacing[2] },
  headline: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  time: { ...font.regular, fontSize: fontSize.xs, lineHeight: lineHeight.small },
  unread: { ...font.medium, fontSize: fontSize.xs, lineHeight: lineHeight.small },
  trailing: { paddingTop: spacing[2] },
});
