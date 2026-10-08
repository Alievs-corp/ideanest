import { CollectionIndex } from '../../components/browse/collection-index';
import { withScreenRoot } from '../../components/screen-root';

/** The collections index — the web's `/collections` (issue #154). See `CollectionIndex`. */
function Screen() {
  return <CollectionIndex />;
}

export default withScreenRoot('collections', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
