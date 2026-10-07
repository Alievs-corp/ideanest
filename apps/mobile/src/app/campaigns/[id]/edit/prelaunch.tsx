import { EditorWebTab } from '../../../../features/editor/editor-web-tab';

/** The editor's prelaunch tab — on the website until its native screen replaces this line (#162). */
export default function Tab() {
  return <EditorWebTab tab="prelaunch" />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
