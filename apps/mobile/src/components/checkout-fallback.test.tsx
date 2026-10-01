import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import * as WebBrowser from 'expo-web-browser';
import en from '@ideanest/messages/en.json';
import CheckoutRoute from '../app/campaigns/[id]/back';
import { setLocale } from '../lib/locale';

/**
 * The checkout placeholder (until #157) — issue #155: the reward a link or "Select this reward"
 * chose reaches the web checkout, so the reader lands on that tier rather than on the picker.
 *
 * <p>Here rather than beside the route, because every file under `src/app` is a route.
 */

const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
let mockParams: Record<string, string | string[]> = {};

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/campaigns/x/back',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.setTimeout(20_000);

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.mocked(WebBrowser.openBrowserAsync).mockClear();
});

async function open(params: Record<string, string | string[]>): Promise<string> {
  mockParams = params;
  await render(
    <IntlProvider locale="en" messages={en}>
      <CheckoutRoute />
    </IntlProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: en.mobile.fallback.open }));
  return String(jest.mocked(WebBrowser.openBrowserAsync).mock.calls[0]?.[0]);
}

describe('the checkout placeholder', () => {
  it('carries the chosen reward to the web checkout, encoded', async () => {
    expect(await open({ id: ID, reward: 'tier 1&x' })).toBe(
      `https://test.invalid/en/projects/${ID}/back?reward=tier%201%26x`,
    );
  });

  it('opens the bare checkout without one', async () => {
    expect(await open({ id: ID })).toBe(`https://test.invalid/en/projects/${ID}/back`);
    jest.mocked(WebBrowser.openBrowserAsync).mockClear();
    expect(await open({ id: ID, reward: ' ' })).toBe(
      `https://test.invalid/en/projects/${ID}/back`,
    );
  });

  it('takes the first of a repeated reward', async () => {
    expect(await open({ id: ID, reward: ['t1', 't2'] })).toBe(
      `https://test.invalid/en/projects/${ID}/back?reward=t1`,
    );
  });
});
