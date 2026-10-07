import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Slot, Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { signInHrefFor } from '../../lib/guard';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { useGateShut } from '../../lib/app-lock';
import { colors } from '../../theme';
import { DashboardTabs, dashboardTabHref, dashboardTabOf } from './dashboard-tabs';

/**
 * `campaigns/[id]/dashboard/*` — the web's dashboard `layout.tsx` (#163).
 *
 * <p>The stack header names the dashboard; the tabs sit under it and the chosen panel below them,
 * each panel scrolling (and refreshing) on its own. Signed out, there is nothing to show: the
 * frame sends the reader to sign in and back to the panel they asked for. Which panels a
 * collaborator may read is the service's answer per request, so each panel draws its own 403.
 */
export function DashboardFrame() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signedIn } = useSession();
  // Not while the app lock is shut: the sign-in modal would sit above the lock screen (#319).
  const shut = useGateShut();
  const active = dashboardTabOf(pathname);

  useEffect(() => {
    if (!signedIn && !shut) router.replace(signInHrefFor(pathname));
  }, [pathname, router, signedIn, shut]);

  return (
    <View style={styles.frame}>
      <Stack.Screen options={{ title: t('dashboard.meta.title'), headerBackTitle: t('mobile.nav.back') }} />
      {signedIn ? (
        <>
          <DashboardTabs active={active} onSelect={(tab) => router.replace(dashboardTabHref(id, tab))} />
          <View style={styles.panel}>
            <Slot />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.surface1 },
  panel: { flex: 1 },
});
