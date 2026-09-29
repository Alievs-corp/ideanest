import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../components/web-fallback';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WebFallback titleKey="checkout.title" webPath={`/projects/${encodeURIComponent(id)}/back`} />;
}
