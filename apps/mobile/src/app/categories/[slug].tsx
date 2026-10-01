import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../components/web-fallback';

/*
 * One category's landing page, on the web until the native screen lands (#154). Home's category
 * tiles open it, so they already point where #154's screen will be.
 */
export default function Screen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return (
    <WebFallback
      titleKey="shell.nav.categories"
      webPath={`/categories/${encodeURIComponent(slug ?? '')}`}
    />
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
