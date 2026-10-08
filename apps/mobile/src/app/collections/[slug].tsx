import { useLocalSearchParams } from 'expo-router';
import { CollectionPage } from '../../components/browse/collection-page';
import { withScreenRoot } from '../../components/screen-root';

/** One collection — the web's `/collections/{slug}` (issue #154). See `CollectionPage`. */
function Screen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CollectionPage slug={slug ?? ''} />;
}

export default withScreenRoot('collection', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
