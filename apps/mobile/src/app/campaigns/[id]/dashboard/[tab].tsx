import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../../components/web-fallback';

export default function Screen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab: string }>();
  return <WebFallback title="Campaign dashboard" webPath={`/projects/${encodeURIComponent(id)}/dashboard/${encodeURIComponent(tab)}`} />;
}
