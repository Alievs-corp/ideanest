import { useLocalSearchParams } from 'expo-router';
import { CheckoutScreen } from '../../../features/checkout/checkout-screen';

function first(value: string | string[] | undefined): string | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  return raw === '' ? null : raw;
}

function tokensOf(value: string | string[] | undefined): readonly string[] {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => entry.split(','))
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

export default function Screen() {
  const { id, reward, token } = useLocalSearchParams<{
    id: string;
    reward?: string | string[];
    token?: string | string[];
  }>();
  return <CheckoutScreen projectId={id} initialRewardId={first(reward)} tokens={tokensOf(token)} />;
}

export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
