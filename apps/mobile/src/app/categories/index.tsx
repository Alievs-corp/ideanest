import { CategoryIndex } from '../../components/browse/category-index';
import { withScreenRoot } from '../../components/screen-root';

/** The categories index — the web's `/categories` (issue #154). See `CategoryIndex`. */
function Screen() {
  return <CategoryIndex />;
}

export default withScreenRoot('categories', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
