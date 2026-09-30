import { StyleSheet, View } from 'react-native';
import { useT } from '../lib/i18n';
import { useLocale } from '../lib/locale';
import { upcomingMessage } from '../lib/maintenance-copy';
import { dismissUpcoming, useUpcomingMaintenance } from '../lib/upcoming-maintenance';
import { colors, spacing } from '../theme';
import { InlineAlert } from './ui';

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
 * The kit's `info` `InlineAlert` (issue #151), so no `alert` role: nothing has gone wrong, and a
 * notice that interrupted a screen reader on every screen of the stack would be an alarm about a
 * date. It is polite — read in its place — and the stripe and icon are never the only sign: the
 * sentence says it.
 *
 * <h2>Closed for that window</h2>
 *
 * The alert's own dismiss button hides it for this window on every screen and across launches,
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
    <View style={styles.banner} testID="maintenance-upcoming">
      <InlineAlert
        variant="info"
        description={t(message.key, message.values)}
        onDismiss={dismissUpcoming}
        dismissLabel={t('dismiss')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    backgroundColor: colors.surface1,
  },
});
