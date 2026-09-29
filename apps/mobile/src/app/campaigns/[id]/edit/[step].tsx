import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../../components/web-fallback';

export default function Screen() {
  const { id, step } = useLocalSearchParams<{ id: string; step: string }>();
  return <WebFallback titleKey="shell.actions.myCampaigns" webPath={`/projects/${encodeURIComponent(id)}/edit/${encodeURIComponent(step)}`} />;
}
