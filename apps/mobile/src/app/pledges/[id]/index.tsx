import { useLocalSearchParams } from 'expo-router';
import { PledgeDetailScreen } from '../../../features/pledges/pledge-detail-screen';
import { PledgeEditor } from '../../../features/pledges/pledge-editor';
import { withScreenRoot } from '../../../components/screen-root';

function Screen() {
  const { id, payment, raise } = useLocalSearchParams<{ id: string; payment?: string; raise?: string }>();
  return (
    <PledgeDetailScreen
      key={id}
      id={id}
      payment={payment}
      raise={raise}
      renderEditor={(pledge, slot) => (
        <PledgeEditor
          key={slot.raising ? 'raise' : 'edit'}
          pledge={pledge}
          mode={slot.raising ? 'raise' : 'edit'}
          disabled={slot.disabled}
          onSaved={slot.onSaved}
          onReload={slot.onReload}
          onRaiseReturned={slot.onRaiseReturned}
        />
      )}
    />
  );
}

export default withScreenRoot('pledge', Screen);

export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
