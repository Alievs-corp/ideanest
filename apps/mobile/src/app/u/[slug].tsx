import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../components/web-fallback';

/** A public profile — the Me tab's identity row lands here. Web-only until the profile issue. */
export default function Screen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return (
    <WebFallback
      titleKey="account.links.profile.label"
      webPath={`/u/${encodeURIComponent(slug)}`}
    />
  );
}
