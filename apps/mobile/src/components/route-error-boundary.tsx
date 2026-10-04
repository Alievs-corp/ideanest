import type { ErrorBoundaryProps } from 'expo-router';
import { traceIdOfError } from '../api/client';
import { Glyphs } from '../icons';
import { useT } from '../lib/i18n';
import { FailureState } from './failure-state';

/**
 * A render error inside a route — issue #150. The app's `app/[locale]/error.tsx`.
 *
 * <h2>Where it is mounted, and why on every route</h2>
 *
 * Expo Router wraps a route in its `ErrorBoundary` export and in nothing else, so a screen that
 * does not export one hands its failure to the nearest layout that does — and the nearest one
 * above a stack screen is the root, whose boundary is outside every provider and can only offer
 * a reload (`root-failure.tsx`). Exporting this from every route keeps the failure inside the
 * screen that threw: the header and its back button stay, as do the tab bar under a tab, and
 * "Try again" re-renders only that screen. The tab layout exports it too, for a throw in the
 * header control or the bar itself. `route-boundaries.test.ts` fails a route that forgets.
 *
 * <h2>What it prints</h2>
 *
 * Never `error.message` or a stack: they are written for whoever reads the logs, and a message
 * from the service is English prose in any language. What it does print is the `X-Trace-Id` of
 * the response that failed, when the failure was one (`traceIdOfError`) — the web prints the
 * digest for the same reason: a reference a reader can quote and be believed. A failure that
 * did not come from a response has no reference line at all.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = useT('shell.failure.pages.error');
  return (
    <FailureState
      title={t('title')}
      description={t('description')}
      actionLabel={t('retry')}
      onAction={() => void retry()}
      reference={traceIdOfError(error)}
      icon={Glyphs.Danger}
    />
  );
}

