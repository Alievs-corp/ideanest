import { CollectionIndex } from '../../components/browse/collection-index';

/** The collections index — the web's `/collections` (issue #154). See `CollectionIndex`. */
export default function Screen() {
  return <CollectionIndex />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
