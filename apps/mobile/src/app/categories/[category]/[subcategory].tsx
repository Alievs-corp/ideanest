import { useLocalSearchParams } from 'expo-router';
import { CategoryLanding } from '../../../components/browse/category-landing';
import { withScreenRoot } from '../../../components/screen-root';

/**
 * A subcategory's landing page — the web's `/categories/{category}/{subcategory}` (issue #154):
 * the category landing with the subcategory set, so no chip row and a two-step trail.
 */
function Screen() {
  const { category, subcategory } = useLocalSearchParams<{
    category: string;
    subcategory: string;
  }>();
  return <CategoryLanding categorySlug={category ?? ''} subcategorySlug={subcategory ?? ''} />;
}

export default withScreenRoot('subcategory', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
