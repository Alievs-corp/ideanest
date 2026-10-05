import { useLocalSearchParams } from 'expo-router';
import { ArchivedLegalDocumentScreen } from '../../../../features/legal/legal-screens';

/** An archived legal version — the web's `/legal/[document]/v/[version]` (issue #164). */
export default function Screen() {
  const { document, version } = useLocalSearchParams<{ document: string; version: string }>();
  return <ArchivedLegalDocumentScreen document={document ?? ''} version={version ?? ''} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
