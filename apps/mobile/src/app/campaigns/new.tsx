import { WebFallback } from '../../components/web-fallback';

export default function Screen() {
  return <WebFallback titleKey="shell.actions.startCampaign" webPath={'/projects/new'} />;
}
