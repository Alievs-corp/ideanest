import type { ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as Clipboard from 'expo-clipboard';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../lib/locale';
import { shouldPersistQuery } from '../../lib/offline';
import { queryKeys } from '../../api/queries';
import {
  ArchivedLegalDocumentScreen,
  LegalDocumentScreen,
  LegalIndexScreen,
  wrappable,
} from './legal-screens';

/**
 * The legal screens — issue #164: the index's eight rows and three status forms, a failure that is
 * never "not published", a document's provenance before its text, the archive's links, versions
 * refused before any request, and the digest that wraps and copies.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const L = en.legal;
const HASH = '0123456789abcdef'.repeat(4);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number) =>
  new Response(JSON.stringify({ status, title: 'x' }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

function document(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'TERMS_OF_USE',
    locale: 'en',
    version: 1,
    title: 'Terms of use',
    body: 'First paragraph.\n\nSecond paragraph.\r\n\r\n   \n\nThird paragraph.',
    contentHash: HASH,
    effectiveFrom: '2026-03-01T20:00:00Z',
    publishedAt: '2026-02-20T10:00:00Z',
    ...overrides,
  };
}

let route: (url: URL) => Response | Promise<Response>;
let requests: URL[];
let client: QueryClient;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  mockPush.mockReset();
  requests = [];
  route = () => json({}, 404);
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    return route(url);
  }) as unknown as typeof fetch;
});

afterEach(() => client?.clear());

async function show(ui: ReactElement) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {ui}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return view;
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('the legal index', () => {
  it('lists the eight documents in order, with the three status forms', async () => {
    route = () =>
      json({
        documents: [
          { kind: 'TERMS_OF_USE', locale: 'en', version: 2, title: 'Terms', effectiveFrom: '2026-03-01T20:00:00Z' },
          { kind: 'PRIVACY_POLICY', locale: 'en', version: 1, title: 'Privacy', effectiveFrom: null },
          { kind: 'BACKER_AGREEMENT', locale: 'en', version: 4, title: 'Backer', effectiveFrom: '2026-01-01T00:00:00Z' },
        ],
      });
    await show(<LegalIndexScreen />);

    expect(requests[0]?.pathname).toMatch(/\/v1\/legal\/documents$/);
    expect(requests[0]?.searchParams.get('locale')).toBe('en');

    const rows = screen.getAllByTestId(/^legal-row-/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'legal-row-terms-of-use',
      'legal-row-privacy-policy',
      'legal-row-cookie-policy',
      'legal-row-platform-rules',
      'legal-row-creator-agreement',
      'legal-row-backer-agreement',
      'legal-row-delivery-and-refund-policy',
      'legal-row-dispute-resolution-policy',
    ]);
    const names = rows.map((row) => row.props.accessibilityLabel as string);
    // In UTC, as the web's server writes it: 20:00 UTC is already the 2nd in Baku.
    expect(names[0]).toBe(`${L.documents['terms-of-use'].title}, Version 2, in force since 1 March 2026 at 20:00 UTC`);
    expect(names[1]).toBe(`${L.documents['privacy-policy'].title}, Version 1`);
    expect(names.filter((name) => name.endsWith(L.index.notPublished))).toHaveLength(5);

    await fireEvent.press(rows[5]!);
    expect(mockPush).toHaveBeenCalledWith('/legal/backer-agreement');
  });

  it('says the documents could not be loaded — never that none is published — when the read fails', async () => {
    route = () => problem(503);
    await show(<LegalIndexScreen />);
    expect(screen.getByText(L.unavailable.indexTitle)).toBeTruthy();
    expect(screen.queryByText(L.index.notPublished)).toBeNull();
    expect(screen.queryByTestId(/^legal-row-/)).toBeNull();

    route = () => json({ documents: [] });
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getAllByTestId(/^legal-row-/)).toHaveLength(8);
  });

  it('treats a body that does not narrow as a failure', async () => {
    route = () => json({ nothing: true });
    await show(<LegalIndexScreen />);
    expect(screen.getByText(L.unavailable.indexTitle)).toBeTruthy();
  });
});

describe('a document in force', () => {
  it('shows provenance first, then the body split on blank lines', async () => {
    route = () => json(document());
    await show(<LegalDocumentScreen document="terms-of-use" />);

    expect(requests[0]?.pathname).toMatch(/\/v1\/legal\/documents\/TERMS_OF_USE$/);
    expect(screen.getByText('Version 1')).toBeTruthy();
    expect(screen.getByText('In force since 1 March 2026 at 20:00 UTC')).toBeTruthy();
    expect(screen.queryByTestId('legal-governing-language')).toBeNull();
    for (const text of ['First paragraph.', 'Second paragraph.', 'Third paragraph.']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.queryByTestId('legal-previous')).toBeNull();
  });

  it('says the text is the governing Azerbaijani one when the language differs', async () => {
    route = () => json(document({ locale: 'az' }));
    await show(<LegalDocumentScreen document="terms-of-use" />);
    expect(screen.getByText(L.meta.governingLanguage)).toBeTruthy();
  });

  it('links to the version before it from version 3', async () => {
    route = () => json(document({ version: 3 }));
    await show(<LegalDocumentScreen document="terms-of-use" />);
    await fireEvent.press(screen.getByRole('link', { name: 'Read version 2' }));
    expect(mockPush).toHaveBeenCalledWith('/legal/terms-of-use/v/2');
  });

  it('says "not published" for a 404, with the way back to the index', async () => {
    route = () => problem(404);
    await show(<LegalDocumentScreen document="cookie-policy" />);
    expect(screen.getByText(L.notPublished.summary)).toBeTruthy();
    expect(screen.getByText(L.notPublished.body)).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: L.backToIndex }));
    expect(mockPush).toHaveBeenCalledWith('/legal');
  });

  it('says it could not be loaded for a 500, with a retry, and never "not published"', async () => {
    route = () => problem(500);
    await show(<LegalDocumentScreen document="cookie-policy" />);
    expect(screen.getByText(L.unavailable.title)).toBeTruthy();
    expect(screen.queryByText(L.notPublished.summary)).toBeNull();
    expect(screen.getByRole('button', { name: en.common.tryAgain })).toBeTruthy();
  });

  it('is the not-found screen for a slug outside the eight, with no request', async () => {
    await show(<LegalDocumentScreen document="TERMS_OF_USE" />);
    expect(screen.getByTestId('legal-not-found')).toBeTruthy();
    expect(requests).toHaveLength(0);
  });
});

describe('an archived version', () => {
  it.each(['0', '00', '100000', 'abc'])('refuses version %j before any request', async (version) => {
    await show(<ArchivedLegalDocumentScreen document="terms-of-use" version={version} />);
    expect(screen.getByTestId('legal-not-found')).toBeTruthy();
    expect(requests).toHaveLength(0);
  });

  it('reads /versions/7, says it is no longer in force and links to the version that is', async () => {
    route = () => json(document({ version: 7 }));
    await show(<ArchivedLegalDocumentScreen document="terms-of-use" version="7" />);
    expect(requests[0]?.pathname).toMatch(/\/v1\/legal\/documents\/TERMS_OF_USE\/versions\/7$/);
    expect(screen.getByText('Version 7 — no longer in force')).toBeTruthy();
    expect(screen.queryByTestId('legal-previous')).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: L.archive.readCurrent }));
    expect(mockPush).toHaveBeenCalledWith('/legal/terms-of-use');
  });

  it('is the not-found screen when the version does not exist', async () => {
    route = () => problem(404);
    await show(<ArchivedLegalDocumentScreen document="terms-of-use" version="9" />);
    expect(screen.getByTestId('legal-not-found')).toBeTruthy();
  });
});

describe('the digest', () => {
  it('breaks every eight characters and is read in groups of four', async () => {
    route = () => json(document());
    await show(<LegalDocumentScreen document="terms-of-use" />);
    expect(wrappable(HASH).split('​')).toEqual(HASH.match(/.{8}/g));
    expect(screen.getByTestId('legal-hash').props.accessibilityLabel).toBe(
      `SHA-256 of this text: ${HASH.match(/.{4}/g)!.join(' ')}`,
    );
  });

  it('copies the whole digest', async () => {
    route = () => json(document());
    await show(<LegalDocumentScreen document="terms-of-use" />);
    await fireEvent.press(screen.getByRole('button', { name: en.mobile.content.copyHash }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(HASH);
  });
});

describe('offline', () => {
  it('keeps the legal texts on disk, but not the checkout’s agreement version', () => {
    expect(shouldPersistQuery(queryKeys.legalCatalogue('en'))).toBe(true);
    expect(shouldPersistQuery(queryKeys.legalText('TERMS_OF_USE', 'en'))).toBe(true);
    expect(shouldPersistQuery(queryKeys.legalArchived('TERMS_OF_USE', 'en', 2))).toBe(true);
    expect(shouldPersistQuery(queryKeys.legalDocument('BACKER_AGREEMENT'))).toBe(false);
  });
});
