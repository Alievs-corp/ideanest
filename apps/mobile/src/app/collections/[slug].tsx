import { useLocalSearchParams } from 'expo-router';
import { CollectionPage } from '../../components/browse/collection-page';

/** One collection — the web's `/collections/{slug}` (issue #154). See `CollectionPage`. */
export default function Screen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CollectionPage slug={slug ?? ''} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
