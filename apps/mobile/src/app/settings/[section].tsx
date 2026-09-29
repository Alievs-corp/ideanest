import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../components/web-fallback';

export default function Screen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  return <WebFallback title="Settings" webPath={`/settings/${encodeURIComponent(section)}`} />;
}
