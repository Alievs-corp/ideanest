import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useT } from '../lib/i18n';
import { useLocale } from '../lib/locale';
import { upcomingMessage } from '../lib/maintenance-copy';
import { dismissUpcoming, useUpcomingMaintenance } from '../lib/upcoming-maintenance';
import { colors, radius, size, spacing } from '../theme';
import { Meta } from './text';

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
 * The `info` stripe and no `alert` role: nothing has gone wrong, and a notice that interrupted a
 * screen reader on every screen of the stack would be an alarm about a date. It is read in its
 * place like any other text, and the stripe is never the only sign — the sentence says it.
 *
 * <h2>Closed for that window</h2>
 *
 * The close button hides it for this window on every screen and across launches, and for no
 * other window. The glyph is drawn, so the button's name is its label from the catalogue
 * (`shell.maintenance.dismiss`); its touch target is the platform minimum.
 */
export function UpcomingMaintenanceBanner() {
  const window = useUpcomingMaintenance();
  const t = useT('shell.maintenance');
  const locale = useLocale();
  if (window === null) return null;

  const message = upcomingMessage(window, locale);
  return (
    <View style={styles.banner} testID="maintenance-upcoming">
      <View style={styles.notice}>
        <Meta tone="secondary" style={styles.text}>
          {t(message.key, message.values)}
        </Meta>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dismiss')}
          onPress={dismissUpcoming}
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" accessible={false}>
            <Path
              d={CLOSE_GLYPH}
              stroke={colors.textSecondary}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

/** A cross on the 24-unit grid the tab glyphs use (`tab-icon.tsx`). */
const CLOSE_GLYPH = 'M6 6l12 12M18 6 6 18';

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    backgroundColor: colors.surface1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingLeft: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface3,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
  },
  text: { flex: 1, paddingVertical: spacing[3] },
  close: {
    width: size.touchTarget,
    height: size.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  closePressed: { backgroundColor: colors.surface2 },
});
