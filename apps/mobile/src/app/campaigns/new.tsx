import { WebFallback } from '../../components/web-fallback';

export default function Screen() {
  return <WebFallback title="Start a campaign" webPath={'/projects/new'} />;
}
