import { useLocalSearchParams } from 'expo-router';
import { CategoryLanding } from '../../../components/browse/category-landing';

/**
 * A category's landing page — the web's `/categories/{category}` (issue #154). Home's category
 * tiles and the index open it, and so does a shared link (`lib/links.ts`).
 */
export default function Screen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  return <CategoryLanding categorySlug={category ?? ''} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
