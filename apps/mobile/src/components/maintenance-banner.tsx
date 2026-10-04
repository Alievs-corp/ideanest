import { useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Glyphs } from '../icons';
import { useT } from '../lib/i18n';
import { useLocale } from '../lib/locale';
import { upcomingMessage } from '../lib/maintenance-copy';
import { dismissUpcoming, useUpcomingMaintenance } from '../lib/upcoming-maintenance';
import { colors, fontSize, lineHeight, radius, spacing } from '../theme';
import { Body } from './text';
import { Icon, IconButton, type IconComponent } from './ui';

/**
 * The planned-maintenance notice under the header — issue #214.
 *
 * "Planned maintenance on 4 Oct 2026, 02:00–02:30", in the reader's language and the phone's
 * time zone, while a window is announced and has not started (`lib/upcoming-maintenance.ts` has
 * where that comes from and how rarely it is asked). It sits where the offline banner does —
 * each navigator's `screenLayout`, through `WithOfflineBanner` — so it lands under whichever
 * header the screen has.
 *
 * <h2>Information, not an alarm</h2>
 *
 * A {@link BannerNotice} with the Bulk calendar glyph in the info tone, so no `alert` role:
 * nothing has gone wrong, and a notice that interrupted a screen reader on every screen of the
 * stack would be an alarm about a date. It is polite — read in its place — and the icon is never
 * the only sign: the sentence says it.
 *
 * <h2>Closed for that window</h2>
 *
 * The notice's dismiss button hides it for this window on every screen and across launches,
 * and for no other window. It is an icon, so its name is the catalogue's
 * `shell.maintenance.dismiss`; its touch target is the platform minimum.
 */
export function UpcomingMaintenanceBanner() {
  const window = useUpcomingMaintenance();
  const t = useT('shell.maintenance');
  const locale = useLocale();
  if (window === null) return null;

  const message = upcomingMessage(window, locale);
  return (
    <BannerNotice
      icon={Glyphs.Calendar}
      tone={colors.info}
      message={t(message.key, message.values)}
      onDismiss={dismissUpcoming}
      dismissLabel={t('dismiss')}
      live
      testID="maintenance-upcoming"
    />
  );
}

/**
 * A notice laid across the top of a screen's content — the offline and the planned-maintenance
 * banners (`mobile-design` skill §2, §5).
 *
 * A raised `surface2` block with a Bulk glyph on a disc in the notice's tone and the sentence
 * beside it: the glyph and the words together, never the hue alone. It appears at once — a
 * banner is not something to watch arrive — and pads by the side safe-area insets, so it never
 * runs under a landscape notch. It sits under the header, clear of the home indicator and the
 * floating tab bar at the other end of the screen.
 */
export function BannerNotice({
  icon,
  tone,
  message,
  onDismiss,
  dismissLabel,
  live = false,
  testID,
}: {
  readonly icon: IconComponent;
  /** A status token: the glyph's colour, never the text's. */
  readonly tone: string;
  readonly message: string;
  readonly onDismiss?: () => void;
  /** Required with `onDismiss`: the close button is an icon. */
  readonly dismissLabel?: string;
  /** A polite live region of its own. Off when a parent already is one (the offline banner). */
  readonly live?: boolean;
  readonly testID?: string;
}) {
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <View
      style={[
        styles.strip,
        {
          paddingLeft: spacing[4] + (insets?.left ?? 0),
          paddingRight: spacing[4] + (insets?.right ?? 0),
        },
      ]}
      accessibilityLiveRegion={live ? 'polite' : 'none'}
      testID={testID}
    >
      <View style={styles.notice}>
        <View style={styles.disc}>
          <Icon icon={icon} variant="bulk" size={20} color={tone} />
        </View>
        <Body style={styles.message}>{message}</Body>
        {onDismiss === undefined ? null : (
          <IconButton
            icon={Glyphs.Close}
            label={dismissLabel ?? ''}
            onPress={onDismiss}
            variant="ghost"
            size="sm"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    backgroundColor: colors.surface1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  disc: {
    width: spacing[8],
    height: spacing[8],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
  },
  message: { flex: 1, fontSize: fontSize.sm, lineHeight: lineHeight.small },
});
