import { Stack, useRouter } from 'expo-router';
import { FailureState } from '../components/failure-state';
import { useT } from '../lib/i18n';

/**
 * Where an unmatched route lands.
 *
 * It exists because a link this application does not have a screen for is not
 * rare — every campaign link is shared with people whose copy is older than the
 * route it names. `lib/links.ts` refuses a link from a host we do not claim
 * before it gets here; what reaches this screen is one of ours that this build
 * does not know about, and the useful thing to offer is the way back rather than
 * an apology. The action is a white pill, as on the web's failure pages.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  const t = useT('shell.failure.pages.notFound');
  return (
    <>
      <Stack.Screen options={{ title: t('metaTitle') }} />
      <FailureState
        title={t('title')}
        description={t('description')}
        actionLabel={t('action')}
        onAction={() => router.replace('/')}
      />
    </>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
