import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import * as client from '../../api/client';
import { queryKeys } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import type { StoredAddress } from './api';
import { ShippingAddressScreen } from './shipping-address-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockGet = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../api/client', () => ({
  api: () => ({ get: mockGet }),
  sendJson: jest.fn(),
}));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
const F = en.account.fulfilment.form;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const PATH = '/v1/pledges/pl-1/shipping-address';

function wire(extra: Partial<Record<string, unknown>> = {}) {
  return {
    pledgeId: 'pl-1',
    address: {
      recipient: ' Aysel Mammadova ',
      line1: '12 Nizami street',
      line2: '',
      locality: 'Baku',
      region: '',
      postcode: 'AZ1000',
      countryCode: 'az',
      phone: '',
    },
    locked: false,
    updatedAt: '2026-09-30T10:00:00Z',
    ...extra,
  };
}

let queryClient: QueryClient;

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(seed?: StoredAddress | null) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  if (seed !== undefined) queryClient.setQueryData(queryKeys.pledgeAddress('pl-1'), seed);
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          <ShippingAddressScreen id="pl-1" />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSession = { signedIn: true, locked: false, unlocked: false };
  setOnline(true);
});

describe('reading the address', () => {
  it('shows four skeleton fields while it loads', async () => {
    mockGet.mockReturnValue(new Promise(() => undefined));
    await show();

    expect(screen.getByLabelText(F.loading)).toBeTruthy();
    expect(screen.queryByTestId('address-save')).toBeNull();
  });

  it('reads a 204 as never given: an empty form with the info alert', async () => {
    mockGet.mockResolvedValue(undefined);
    await show();

    expect(mockGet).toHaveBeenCalledWith('/v1/pledges/{pledgeId}/shipping-address', expect.objectContaining({ path: { pledgeId: 'pl-1' } }));
    expect(screen.getByTestId('address-never-given')).toHaveTextContent(new RegExp(F.noAddressTitle));
    expect(screen.getByTestId('address-recipient').props.value).toBe('');
    expect(screen.getByTestId('address-save')).toBeTruthy();
  });

  it('fills the form and names the country in the app language', async () => {
    mockGet.mockResolvedValue(wire());
    await show();

    expect(screen.getByTestId('address-line1').props.value).toBe('12 Nizami street');
    expect(screen.getByTestId('address-countryCode').props.accessibilityValue).toEqual({ text: 'Azerbaijan' });
    expect(screen.queryByTestId('address-never-given')).toBeNull();
  });

  it('says a missing pledge could not be found, with nothing to retry', async () => {
    mockGet.mockRejectedValue(new ApiError(404, { type: 'about:blank', title: 'Not found', status: 404 }));
    await show();

    const alert = screen.getByTestId('address-load-failed');
    expect(alert).toHaveTextContent(new RegExp(F.loadFailedTitle));
    expect(alert).toHaveTextContent(/Not found/);
    expect(screen.queryByLabelText(en.common.tryAgain)).toBeNull();
  });

  it('says the service could not be reached, and retries', async () => {
    mockGet.mockRejectedValueOnce(new TypeError('Network request failed'));
    await show();

    expect(screen.getByTestId('address-load-failed')).toHaveTextContent(new RegExp(F.unreachable));
    mockGet.mockResolvedValue(wire());
    await fireEvent.press(screen.getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.getByTestId('address-line1').props.value).toBe('12 Nizami street');
  });

  it('sends a signed-out reader to sign in and back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/pledges/pl-1/address' },
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('saving the address', () => {
  it('checks the required fields on the device and sends nothing', async () => {
    mockGet.mockResolvedValue(undefined);
    await show();

    await fireEvent.press(screen.getByTestId('address-save'));

    expect(screen.getAllByText(F.requiredField)).toHaveLength(4);
    for (const key of ['recipient', 'line1', 'locality', 'countryCode']) {
      expect(screen.getByTestId(`address-field-${key}`)).toHaveTextContent(new RegExp(F.requiredField));
    }
    for (const key of ['line2', 'region', 'postcode', 'phone']) {
      expect(screen.getByTestId(`address-field-${key}`)).not.toHaveTextContent(new RegExp(F.requiredField));
    }
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('sends all eight fields when one was edited: trimmed, the country upper-cased', async () => {
    mockGet.mockResolvedValue(wire());
    sendJson.mockResolvedValue(wire({ address: { ...wire().address, line2: 'Flat 4', countryCode: 'AZ' } }));
    await show();

    await fireEvent.changeText(screen.getByTestId('address-line2'), '  Flat 4  ');
    await fireEvent.press(screen.getByTestId('address-save'));
    await settle();

    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledWith('PATCH', PATH, {
      recipient: 'Aysel Mammadova',
      line1: '12 Nizami street',
      line2: 'Flat 4',
      locality: 'Baku',
      region: '',
      postcode: 'AZ1000',
      countryCode: 'AZ',
      phone: '',
    });
    expect(Object.keys(sendJson.mock.calls[0]?.[2] as object).sort()).toEqual(
      ['countryCode', 'line1', 'line2', 'locality', 'phone', 'postcode', 'recipient', 'region'],
    );
    expect(screen.getByTestId('address-saved')).toHaveTextContent(new RegExp(F.savedTitle));
    expect(screen.getByTestId('address-saved')).toHaveTextContent(/as of/);
  });

  it('stores the chosen country as its two-letter code', async () => {
    mockGet.mockResolvedValue(undefined);
    sendJson.mockResolvedValue(wire());
    await show();

    await fireEvent.changeText(screen.getByTestId('address-recipient'), 'Aysel');
    await fireEvent.changeText(screen.getByTestId('address-line1'), 'Nizami 12');
    await fireEvent.changeText(screen.getByTestId('address-locality'), 'Baku');
    await fireEvent.press(screen.getByTestId('address-countryCode'));
    await fireEvent.press(screen.getByText('Türkiye'));
    await fireEvent.press(screen.getByTestId('address-save'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('PATCH', PATH, expect.objectContaining({ countryCode: 'TR' }));
  });

  it('shows the danger alert with the service detail when the save is refused', async () => {
    mockGet.mockResolvedValue(wire());
    sendJson.mockRejectedValue(
      new ApiError(409, { type: 'about:blank', title: 'Conflict', status: 409, detail: 'The address is locked.' }),
    );
    await show();

    await fireEvent.press(screen.getByTestId('address-save'));
    await settle();

    const alert = screen.getByTestId('address-save-failed');
    expect(alert).toHaveTextContent(new RegExp(F.saveFailedTitle));
    expect(alert).toHaveTextContent(/The address is locked\./);
    expect(screen.queryByTestId('address-saved')).toBeNull();
  });

  it('says the service could not be reached when the save never arrived', async () => {
    mockGet.mockResolvedValue(wire());
    sendJson.mockRejectedValue(new TypeError('Network request failed'));
    await show();

    await fireEvent.press(screen.getByTestId('address-save'));
    await settle();

    expect(screen.getByTestId('address-save-failed')).toHaveTextContent(new RegExp(F.unreachable));
  });
});

describe('when the address cannot be changed', () => {
  it('reads a locked address with every field read-only and no Save', async () => {
    mockGet.mockResolvedValue(wire({ locked: true, lockedAt: '2026-09-28T09:00:00Z' }));
    await show();

    expect(screen.getByTestId('address-locked')).toHaveTextContent(new RegExp(F.lockedTitle));
    expect(screen.getByTestId('address-locked')).toHaveTextContent(/closed changes on/);
    for (const key of ['recipient', 'line1', 'line2', 'locality', 'region', 'postcode', 'countryCode', 'phone']) {
      expect(screen.getByTestId(`address-${key}`)).toBeDisabled();
    }
    expect(screen.queryByTestId('address-save')).toBeNull();
    expect(screen.queryByTestId('address-never-given')).toBeNull();
  });

  it('keeps the cached address readable offline, with the notice and writes disabled', async () => {
    setOnline(false);
    await show({
      address: {
        recipient: 'Aysel',
        line1: 'Nizami 12',
        line2: '',
        locality: 'Baku',
        region: '',
        postcode: '',
        countryCode: 'AZ',
        phone: '',
      },
      locked: false,
      lockedAt: null,
      updatedAt: null,
    });

    expect(screen.getByText(en.mobile.offline.banner)).toBeTruthy();
    expect(screen.getByTestId('address-line1').props.value).toBe('Nizami 12');
    expect(screen.getByTestId('address-line1')).toBeDisabled();
    expect(screen.getByTestId('address-countryCode')).toBeDisabled();
    expect(screen.getByTestId('address-save')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('address-save'));
    expect(sendJson).not.toHaveBeenCalled();
  });
});

describe('accessibility', () => {
  it('names every field, says which are required, and keeps the country format for screen readers', async () => {
    mockGet.mockResolvedValue(undefined);
    await show();

    const required = en.mobile.kitForm.requiredLabel;
    for (const label of [F.recipient, F.line1, F.locality]) {
      expect(screen.getByLabelText(required.replace('{label}', label))).toBeTruthy();
    }
    for (const label of [F.line2, F.region, F.postcode, F.phone]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    const country = screen.getByLabelText(required.replace('{label}', F.country));
    expect(country.props.accessibilityRole).toBe('combobox');
    expect(country.props.accessibilityHint).toBe(F.countryHint);
    expect(screen.getByLabelText(F.phone).props.accessibilityHint).toBe(F.phoneHint);
  });

  it('gives each text field its native autofill type', async () => {
    mockGet.mockResolvedValue(undefined);
    await show();

    const expected: Record<string, [string, string]> = {
      recipient: ['name', 'name'],
      line1: ['address-line1', 'streetAddressLine1'],
      line2: ['address-line2', 'streetAddressLine2'],
      locality: ['postal-address-locality', 'addressCity'],
      region: ['postal-address-region', 'addressState'],
      postcode: ['postal-code', 'postalCode'],
      phone: ['tel', 'telephoneNumber'],
    };
    for (const [key, [autoComplete, textContentType]] of Object.entries(expected)) {
      const input = screen.getByTestId(`address-${key}`);
      expect(input.props.autoComplete).toBe(autoComplete);
      expect(input.props.textContentType).toBe(textContentType);
    }
  });

  it('links back to the deliveries', async () => {
    mockGet.mockResolvedValue(undefined);
    await show();

    const back = screen.getByTestId('address-back');
    expect(back.props.accessibilityRole).toBe('link');
    await fireEvent.press(back);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/account/[section]', params: { section: 'deliveries' } });
  });
});
