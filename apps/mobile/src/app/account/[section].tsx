import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../components/web-fallback';

export default function Screen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  return <WebFallback title="Your account" webPath={`/account/${section}`} />;
}
