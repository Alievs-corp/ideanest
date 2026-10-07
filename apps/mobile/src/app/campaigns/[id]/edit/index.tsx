import { Redirect, useLocalSearchParams } from 'expo-router';

/** The bare editor opens its first tab, as the web's `/projects/{id}/edit` does (#162). */
export default function EditIndex() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Redirect href={{ pathname: '/campaigns/[id]/edit/basics', params: { id: typeof id === 'string' ? id : '' } }} />
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
