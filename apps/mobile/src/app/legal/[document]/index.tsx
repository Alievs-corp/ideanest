import { useLocalSearchParams } from 'expo-router';
import { LegalDocumentScreen } from '../../../features/legal/legal-screens';
import { withScreenRoot } from '../../../components/screen-root';

/** A legal document in force — the web's `/legal/[document]` (issue #164). */
function Screen() {
  const { document } = useLocalSearchParams<{ document: string }>();
  return <LegalDocumentScreen document={document ?? ''} />;
}

export default withScreenRoot('legal-document', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
