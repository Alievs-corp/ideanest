import { PledgeListScreen } from '../../features/pledges/pledge-list-screen';
import { withScreenRoot } from '../../components/screen-root';

export default withScreenRoot('pledges', PledgeListScreen);

export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
