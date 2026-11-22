import { StudentVerificationScreen } from '../../features/student/student-verification-screen';
import { withScreenRoot } from '../../components/screen-root';

/**
 * The student card check (#655). See `features/student/student-verification-screen.tsx`. Not one
 * of the web's settings panels, so no link opens it: the student plan's card and the Me hub do.
 */
export default withScreenRoot('settings-student', StudentVerificationScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
