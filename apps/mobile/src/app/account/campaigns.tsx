import { Stack } from 'expo-router';
import { MyCampaignsList } from '../../features/account/my-campaigns-list';
import { useT } from '../../lib/i18n';

/** My campaigns — the web's `/account/campaigns` (#159). See `features/account/my-campaigns-list.tsx`. */
export default function Screen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('account.links.campaigns.label') }} />
      <MyCampaignsList />
    </>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
