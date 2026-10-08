import { RewardsPanel } from '../../../../features/editor/rewards/rewards-panel';
import { withScreenRoot } from '../../../../components/screen-root';

/** The editor's Rewards tab — the web's `/projects/{id}/edit/rewards` (#162). */
export default withScreenRoot('editor-rewards', RewardsPanel);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
