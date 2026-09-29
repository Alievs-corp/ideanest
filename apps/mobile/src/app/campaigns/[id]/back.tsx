import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../components/web-fallback';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WebFallback title="Back this campaign" webPath={`/projects/${encodeURIComponent(id)}/back`} />;
}
