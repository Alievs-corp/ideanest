import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../../components/web-fallback';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WebFallback titleKey="dashboard.meta.title" webPath={`/projects/${encodeURIComponent(id)}/dashboard`} />;
}
