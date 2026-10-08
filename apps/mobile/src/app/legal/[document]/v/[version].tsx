import { useLocalSearchParams } from 'expo-router';
import { ArchivedLegalDocumentScreen } from '../../../../features/legal/legal-screens';
import { withScreenRoot } from '../../../../components/screen-root';

/** An archived legal version — the web's `/legal/[document]/v/[version]` (issue #164). */
function Screen() {
  const { document, version } = useLocalSearchParams<{ document: string; version: string }>();
  return <ArchivedLegalDocumentScreen document={document ?? ''} version={version ?? ''} />;
}

export default withScreenRoot('legal-version', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
