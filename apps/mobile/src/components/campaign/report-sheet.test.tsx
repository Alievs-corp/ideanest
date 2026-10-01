import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as SecureStore from 'expo-secure-store';
import en from '@ideanest/messages/en.json';
import { DETAIL_MAX_LENGTH, REPORT_REASONS } from '@ideanest/campaign/report';
import { setLocale } from '../../lib/locale';
import { rememberAccessToken, storeRefreshToken, useFlagStore } from '../../lib/session';
import { memoryStore } from '../../lib/storage';
import { ReportLink } from './report-link';

/**
 * The report sheet — issue #155's tests: Send is disabled until a reason is chosen, `OTHER`
 * without a sentence is refused with `detailRequired`, the detail is capped at 2000, and success
 * replaces the form — plus every control's accessible name, the signed-out invitation and offline.
 *
 * <p>Opened from block 14's link, as a reader opens it; the write goes through the app's own
 * `sendJson`, and only `fetch` is a double.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.setTimeout(30_000);

const R = en.moderation.report;
const REASONS = en.admin.moderation.reason;
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const TITLE = 'Solar Lamp';
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const keychain = SecureStore as unknown as { __reset: () => void };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

let report: () => Response | Promise<Response>;
let writes: { path: string; body: unknown }[];
let client: QueryClient;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  keychain.__reset();
  useFlagStore(memoryStore());
  rememberAccessToken(null);
  jest.clearAllMocks();
  writes = [];
  report = () => json({ id: 'r1', reason: 'SPAM', state: 'OPEN' }, 202);
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/auth/refresh') return problem(401);
    writes.push({
      path: `${init?.method ?? 'GET'} ${url.pathname}`,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    if (url.pathname === `/v1/projects/${ID}/report`) return report();
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  client?.clear();
  jest.restoreAllMocks();
});

async function signIn() {
  await storeRefreshToken('refresh-1');
  rememberAccessToken('access-1');
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function open({ offline = false } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  await render(<ReportLink projectId={ID} title={TITLE} offline={offline} />, { wrapper });
  if (!offline) {
    await fireEvent.press(screen.getByRole('button', { name: R.triggerOn.campaign }));
  }
  await settle();
}

const submit = () => screen.getByTestId('report-submit');
const disabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  node.props.accessibilityState?.disabled === true;

describe('the link', () => {
  it('is named "Report this campaign" and opens the sheet titled with the campaign', async () => {
    await signIn();
    await open();
    expect(screen.getByRole('header', { name: R.dialogLabel.replace('{name}', TITLE) })).toBeTruthy();
  });

  it('is disabled offline and says why', async () => {
    await signIn();
    await open({ offline: true });
    const link = screen.getByRole('button', { name: R.triggerOn.campaign });
    expect(disabled(link)).toBe(true);
    expect(link.props.accessibilityHint).toBe(en.mobile.campaign.report.offline);
    expect(screen.getByText(en.mobile.campaign.report.offline)).toBeTruthy();
    expect(screen.queryByTestId('report-sheet')).toBeNull();
  });
});

describe('the form', () => {
  it('names the nine reasons as the console does, each with its description', async () => {
    await signIn();
    await open();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.props.accessibilityLabel)).toEqual(
      REPORT_REASONS.map((reason) => REASONS[reason]),
    );
    expect(radios.map((radio) => radio.props.accessibilityHint)).toEqual(
      REPORT_REASONS.map((reason) => R.descriptions[reason]),
    );
    expect(screen.getByRole('header', { name: `${R.reasonLabel}, required` })).toBeTruthy();
    expect(screen.getByLabelText(R.detailLabel)).toBeTruthy();
    expect(screen.getByRole('button', { name: R.submit })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.cancel })).toBeTruthy();
  });

  it('keeps Send disabled until a reason is chosen', async () => {
    await signIn();
    await open();
    expect(disabled(submit())).toBe(true);
    await fireEvent.press(submit());
    expect(writes).toEqual([]);

    await fireEvent.press(screen.getByRole('radio', { name: REASONS.SPAM }));
    expect(disabled(submit())).toBe(false);
  });

  it('refuses OTHER without a sentence, and sends nothing', async () => {
    await signIn();
    await open();
    await fireEvent.press(screen.getByRole('radio', { name: REASONS.OTHER }));
    await fireEvent.changeText(screen.getByTestId('report-detail'), '   ');
    await fireEvent.press(submit());
    await settle();
    expect(screen.getByText(R.detailRequired)).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it('caps the detail at 2000 characters', async () => {
    await signIn();
    await open();
    expect(screen.getByLabelText(R.detailLabel).props.maxLength).toBe(DETAIL_MAX_LENGTH);
    expect(DETAIL_MAX_LENGTH).toBe(2000);
  });

  it('sends the reason and the trimmed detail, and replaces the form with the acknowledgement', async () => {
    await signIn();
    await open();
    await fireEvent.press(screen.getByRole('radio', { name: REASONS.OTHER }));
    // OTHER makes the detail required, and its name says so.
    const detail = screen.getByTestId('report-detail');
    expect(detail.props.accessibilityLabel).toBe(`${R.detailLabel}, required`);
    await fireEvent.changeText(detail, '  It copies another lamp.  ');
    await fireEvent.press(submit());
    await settle();
    expect(writes).toEqual([
      {
        path: `POST /v1/projects/${ID}/report`,
        body: { reason: 'OTHER', detail: 'It copies another lamp.' },
      },
    ]);
    expect(screen.queryByTestId('report-form')).toBeNull();
    expect(screen.getByText(R.filedTitle)).toBeTruthy();
    expect(screen.getByText(R.filedBody.campaign)).toBeTruthy();
    // The pill, beside the sheet's own X, which is named the same.
    expect(screen.getByTestId('report-close').props.accessibilityLabel).toBe(R.close);
  });

  it('omits an empty detail from the body', async () => {
    await signIn();
    await open();
    await fireEvent.press(screen.getByRole('radio', { name: REASONS.SPAM }));
    await fireEvent.press(submit());
    await settle();
    expect(writes).toEqual([{ path: `POST /v1/projects/${ID}/report`, body: { reason: 'SPAM' } }]);
  });

  it("shows the service's words for a refusal, its own without them, and unreachable", async () => {
    await signIn();
    report = () => problem(429, { detail: 'You have reported a lot today.' });
    await open();
    await fireEvent.press(screen.getByRole('radio', { name: REASONS.FRAUD }));
    await fireEvent.press(submit());
    await settle();
    expect(screen.getByText(R.errorTitle)).toBeTruthy();
    expect(screen.getByText('You have reported a lot today.')).toBeTruthy();

    report = () => problem(500);
    await fireEvent.press(submit());
    await settle();
    expect(screen.getByText(R.refused)).toBeTruthy();

    report = () => Promise.reject(new TypeError('Network request failed'));
    await fireEvent.press(submit());
    await settle();
    expect(screen.getByText(R.unreachable)).toBeTruthy();
  });
});

describe('signed out', () => {
  it('explains why an account is needed and offers sign-in instead of the form', async () => {
    await open();
    expect(screen.getByText(R.signedOutBody)).toBeTruthy();
    expect(screen.queryByTestId('report-form')).toBeNull();
    expect(screen.getByRole('button', { name: R.signIn })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.cancel })).toBeTruthy();
  });
});
