import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../components/web-fallback';

/**
 * The checkout — the web's `/projects/{id}/back`, a placeholder until #157 builds it here.
 *
 * It carries `?reward=` on to the web checkout, so "Select this reward" — and a link that
 * `lib/links.ts` opened here with the tier it named — lands on that tier rather than on the
 * picker. Encoded once, as a query value; the id is the service's and is not read here.
 */
export default function Screen() {
  const { id, reward } = useLocalSearchParams<{ id: string; reward?: string | string[] }>();
  const tier = (Array.isArray(reward) ? reward[0] : reward)?.trim() ?? '';
  const query = tier === '' ? '' : `?reward=${encodeURIComponent(tier)}`;
  return (
    <WebFallback
      titleKey="checkout.title"
      webPath={`/projects/${encodeURIComponent(id)}/back${query}`}
    />
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
