import { StoryPanel } from '../../../../features/editor/story/story-panel';

/** The editor's Story tab — the web's `/projects/{id}/edit/story` (#162). */
export default StoryPanel;

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
