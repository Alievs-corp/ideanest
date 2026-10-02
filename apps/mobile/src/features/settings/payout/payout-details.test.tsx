import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as WebBrowser from 'expo-web-browser';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import * as client from '../../../api/client';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { CHECKS, CHECK_INTERVAL_MS, cardHintOf, cardReturnFor, readCardHint } from './card-return';
import { PayoutSettingsScreen } from './payout-details';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockGet = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../../api/client', () => ({ api: () => ({ get: mockGet }), sendJson: jest.fn() }));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
const browser = jest.mocked(WebBrowser);
const P = en.settings.panels.payout;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const EMPTY_SUBJECT = { recorded: false, complete: false };
const COMPANY = {
  recorded: true,
  complete: true,
  subjectKind: 'LEGAL_ENTITY',
  legalName: 'Kilim Studio MMC',
  taxId: '1234567890',
  registeredAddress: 'Nizami street 10, Baku',
  registrationNumber: 'R 55',
};
const NO_CARD = { recorded: false, standing: 'NONE' };
const CARD = {
  recorded: true,
  standing: 'AWAITING_VERIFICATION',
  displayHint: 'Visa ending 4242',
  holderName: 'KILIM STUDIO',
  updatedAt: '2030-01-01T00:00:00Z',
};

let subject: unknown = EMPTY_SUBJECT;
let destination: unknown = NO_CARD;

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, { type: 'about:blank', title: 'Refused', status, detail: 'Refused.', code });
}

function destinationReads(): number {
  return mockGet.mock.calls.filter(([path]) => path === '/v1/me/payout-destination').length;
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
  }
}

async function wait(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function show(card?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          <PayoutSettingsScreen card={card} />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return view;
}

beforeEach(async () => {
  jest.useFakeTimers();
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSession = { signedIn: true, locked: false, unlocked: false };
  setOnline(true);
  subject = EMPTY_SUBJECT;
  destination = NO_CARD;
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/v1/me/legal-subject') return subject;
    if (path === '/v1/me/payout-destination') return destination;
    throw new Error(`Unexpected read ${path}`);
  });
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' } as WebBrowser.WebBrowserAuthSessionResult);
});

afterEach(() => jest.useRealTimers());

describe('card return addresses', () => {
  it('returns through the site with via=app, in the app language', () => {
    expect(cardReturnFor('az', 'https://ideyanest.com/')).toEqual({
      language: 'az',
      successUrl: 'https://ideyanest.com/az/settings/payout?card=returned&via=app',
      errorUrl: 'https://ideyanest.com/az/settings/payout?card=failed&via=app',
    });
  });

  it('reads only returned or failed from the return', () => {
    expect(cardHintOf('ideanest://settings/payout?card=returned')).toBe('returned');
    expect(cardHintOf('ideanest://settings/payout?card=failed#x')).toBe('failed');
    expect(cardHintOf('ideanest://settings/payout?card=verified')).toBeNull();
    expect(cardHintOf('ideanest://settings/payout')).toBeNull();
    expect(readCardHint('returned')).toBe('returned');
    expect(readCardHint(['returned'])).toBeNull();
  });
});

describe('payout details', () => {
  it('shows two skeletons while loading, named for what loads', async () => {
    mockGet.mockImplementation(() => new Promise(() => undefined));
    await show();
    expect(screen.getByTestId('payout-loading')).toBeTruthy();
    expect(screen.getByLabelText(P.loading)).toBeTruthy();
  });

  it('says the read failed and reads again on Try again', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    await show();
    expect(screen.getByTestId('payout-failed')).toBeTruthy();
    expect(screen.getByText(P.failed)).toBeTruthy();

    mockGet.mockImplementation(async (path: string) => (path === '/v1/me/legal-subject' ? subject : destination));
    await fireEvent.press(screen.getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.queryByTestId('payout-failed')).toBeNull();
    expect(screen.getByTestId('payout-card-none')).toBeTruthy();
    expect(screen.getByLabelText(P.register)).toBeTruthy();
  });

  it('fills the form from the record and shows the card on file with its standing', async () => {
    subject = COMPANY;
    destination = CARD;
    await show();

    expect(screen.getByTestId('payout-legal-name').props.value).toBe('Kilim Studio MMC');
    expect(screen.getByTestId('payout-registered-address').props.value).toBe('Nizami street 10, Baku');
    expect(screen.getByTestId('payout-kind-LEGAL_ENTITY').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('payout-kind-INDIVIDUAL').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByText('Visa ending 4242, held by KILIM STUDIO')).toBeTruthy();
    expect(screen.getByText(P.standingAwaiting)).toBeTruthy();
    expect(screen.getByLabelText(P.replace)).toBeTruthy();
    expect(screen.getByTestId('payout-tax-id').props.keyboardType).toBe('number-pad');
  });

  it('asks for the company fields only for a company, and saves what it shows', async () => {
    sendJson.mockResolvedValue({ recorded: true, subjectKind: 'INDIVIDUAL', legalName: 'Aysel Mammadova' });
    await show();
    expect(screen.queryByTestId('payout-registered-address')).toBeNull();

    await fireEvent.press(screen.getByTestId('payout-kind-LEGAL_ENTITY'));
    expect(screen.getByTestId('payout-registered-address')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('payout-registered-address'), 'Somewhere');
    await fireEvent.press(screen.getByTestId('payout-kind-INDIVIDUAL'));
    expect(screen.queryByTestId('payout-registered-address')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('payout-legal-name'), ' Aysel Mammadova ');
    await fireEvent.changeText(screen.getByTestId('payout-tax-id'), ' 1234567890 ');
    const before = destinationReads();
    await fireEvent.press(screen.getByTestId('payout-subject-save'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('PUT', '/v1/me/legal-subject', {
      subjectKind: 'INDIVIDUAL',
      legalName: 'Aysel Mammadova',
      taxId: '1234567890',
      registeredAddress: null,
      registrationNumber: null,
    });
    expect(screen.getByTestId('payout-subject-saved')).toBeTruthy();
    // The standing depends on the legal name, so the card is read again.
    expect(destinationReads()).toBe(before + 1);
  });

  it('puts MALFORMED_TAX_IDENTIFIER under the VÖEN, and anything else in the card', async () => {
    sendJson.mockRejectedValueOnce(refusal(400, 'MALFORMED_TAX_IDENTIFIER'));
    await show();
    await fireEvent.changeText(screen.getByTestId('payout-legal-name'), 'Aysel Mammadova');
    await fireEvent.changeText(screen.getByTestId('payout-tax-id'), '12');
    await fireEvent.press(screen.getByTestId('payout-subject-save'));
    await settle();
    expect(screen.getAllByText(P.malformedTaxId).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('payout-subject-failed')).toBeNull();

    sendJson.mockRejectedValueOnce(refusal(500, 'INTERNAL'));
    await fireEvent.press(screen.getByTestId('payout-subject-save'));
    await settle();
    expect(screen.getByTestId('payout-subject-failed')).toBeTruthy();
    expect(screen.queryByText(P.malformedTaxId)).toBeNull();
  });

  it('opens the provider in the in-app browser, returning through the site', async () => {
    sendJson.mockResolvedValue({ provider: 'PAYRIFF', redirectUrl: 'https://provider.invalid/card' });
    await show();
    await fireEvent.press(screen.getByTestId('payout-card-register'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/me/payout-destination/card-registration', {
      language: 'en',
      successUrl: 'https://test.invalid/en/settings/payout?card=returned&via=app',
      errorUrl: 'https://test.invalid/en/settings/payout?card=failed&via=app',
    });
    expect(browser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://provider.invalid/card',
      'ideanest://settings/payout',
    );
    // The app never asks for the card number: there is no field for one.
    expect(screen.queryByLabelText(/card number/i)).toBeNull();
  });

  it('polls every 3 s after a return until updatedAt changes', async () => {
    destination = { ...CARD, standing: 'NONE', recorded: false };
    sendJson.mockResolvedValue({ redirectUrl: 'https://provider.invalid/card' });
    browser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'ideanest://settings/payout?card=returned',
    });
    await show();
    await fireEvent.press(screen.getByTestId('payout-card-register'));
    await settle();
    expect(screen.getByTestId('payout-card-waiting')).toBeTruthy();
    const start = destinationReads();

    await wait(CHECK_INTERVAL_MS);
    expect(destinationReads()).toBe(start + 1);
    await wait(CHECK_INTERVAL_MS);
    expect(destinationReads()).toBe(start + 2);

    destination = { ...CARD, updatedAt: '2030-01-01T00:01:00Z' };
    await wait(CHECK_INTERVAL_MS);
    expect(destinationReads()).toBe(start + 3);
    expect(screen.queryByTestId('payout-card-waiting')).toBeNull();
    expect(screen.getByText('Visa ending 4242, held by KILIM STUDIO')).toBeTruthy();

    await wait(CHECK_INTERVAL_MS * 5);
    expect(destinationReads()).toBe(start + 3);
  });

  it('stops after 20 checks when nothing changes', async () => {
    destination = CARD;
    await show('returned');
    expect(mockRouter.setParams).toHaveBeenCalledWith({ card: undefined });
    expect(screen.getByTestId('payout-card-waiting')).toBeTruthy();
    const start = destinationReads();

    for (let i = 0; i < CHECKS + 5; i += 1) await wait(CHECK_INTERVAL_MS);
    expect(destinationReads()).toBe(start + CHECKS);
    expect(screen.queryByTestId('payout-card-waiting')).toBeNull();
  });

  it('re-reads after the browser is dismissed, without claiming the provider is confirming', async () => {
    sendJson.mockResolvedValue({ redirectUrl: 'https://provider.invalid/card' });
    await show();
    await fireEvent.press(screen.getByTestId('payout-card-register'));
    await settle();
    expect(screen.queryByTestId('payout-card-waiting')).toBeNull();
    const start = destinationReads();
    await wait(CHECK_INTERVAL_MS);
    expect(destinationReads()).toBe(start + 1);
  });

  it('stops polling when the screen goes away', async () => {
    destination = CARD;
    const view = await show('returned');
    const start = destinationReads();
    await wait(CHECK_INTERVAL_MS);
    expect(destinationReads()).toBe(start + 1);

    await view.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 5);
    });
    expect(destinationReads()).toBe(start + 1);
  });

  it('says the card was not registered after card=failed, and does not poll', async () => {
    await show('failed');
    expect(screen.getByTestId('payout-card-failed')).toBeTruthy();
    expect(screen.getByText(P.cardFailed)).toBeTruthy();
    const start = destinationReads();
    await wait(CHECK_INTERVAL_MS * 2);
    expect(destinationReads()).toBe(start);
  });

  it('says when cards cannot be registered on this deployment', async () => {
    sendJson.mockRejectedValueOnce(refusal(503, 'PAYOUT_CARDS_UNAVAILABLE'));
    await show();
    await fireEvent.press(screen.getByTestId('payout-card-register'));
    await settle();
    expect(screen.getByText(P.unavailable)).toBeTruthy();
    expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('is read-only offline', async () => {
    subject = COMPANY;
    destination = CARD;
    await show();
    setOnline(false);
    await settle();

    expect(screen.getByTestId('settings-offline')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('payout-subject-save'));
    await fireEvent.press(screen.getByTestId('payout-card-register'));
    await settle();
    expect(sendJson).not.toHaveBeenCalled();
    expect(screen.getByTestId('payout-legal-name').props.editable).toBe(false);
    expect(screen.getByText('Visa ending 4242, held by KILIM STUDIO')).toBeTruthy();
  });

  it('sends a signed-out reader to sign in and reads nothing', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();
    expect(mockRouter.replace).toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
