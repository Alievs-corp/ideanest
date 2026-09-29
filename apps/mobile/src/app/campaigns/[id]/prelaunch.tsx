import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../components/web-fallback';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WebFallback title="Pre-launch page" webPath={`/projects/${id}/prelaunch`} />;
}
