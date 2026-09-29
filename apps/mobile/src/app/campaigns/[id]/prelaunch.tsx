import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../components/web-fallback';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WebFallback titleKey="shell.actions.myCampaigns" webPath={`/projects/${encodeURIComponent(id)}/prelaunch`} />;
}
