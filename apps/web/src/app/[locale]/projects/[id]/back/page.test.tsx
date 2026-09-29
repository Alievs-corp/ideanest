import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SUPPORTED_LOCALES, type Locale } from '../../../../../lib/i18n/locale';
import { fetchLegalDocument } from '../../../../../lib/api/server';
import { fetchFeeDisclosure } from '../../../../../lib/fees/server';
import { resolveServerTree } from '../../../../../test-support/server-tree';
import az from '../../../../../../messages/az.json';
import en from '../../../../../../messages/en.json';
import ru from '../../../../../../messages/ru.json';
import tr from '../../../../../../messages/tr.json';
import BackProjectPage from './page';

/**
 * The checkout and its backer-agreement read — issue #147.
 *
 * <p>The read used to answer `null` for a 404 and for an outage alike, and `null` meant "no
 * agreement in force": during an outage the checkout was drawn without §22.3's risk statement
 * and with a confirmation the service refuses once an agreement is in force. Now a published
 * agreement reaches the checkout as its version, an unpublished one as `null`, and a failed
 * read is the failure state in place of a checkout.
 */

const state = vi.hoisted(() => ({ locale: 'en' as Locale }));

vi.mock('../../../../../lib/api/server', () => ({ fetchLegalDocument: vi.fn() }));
vi.mock('../../../../../lib/fees/server', () => ({ fetchFeeDisclosure: vi.fn() }));

/*
 * The client island is replaced by a stub that prints what it was given. Its own behaviour has
 * its own tests; what this file owns is what the page hands it, and whether it is mounted.
 */
vi.mock('../../../../../components/checkout/CheckoutView', () => ({
  CheckoutView: ({ backerAgreementVersion }: { backerAgreementVersion: number | null }) => (
    <div data-testid="checkout">{`agreement:${String(backerAgreementVersion)}`}</div>
  ),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const catalogues = {
    az: (await import('../../../../../../messages/az.json')).default,
    en: (await import('../../../../../../messages/en.json')).default,
    ru: (await import('../../../../../../messages/ru.json')).default,
    tr: (await import('../../../../../../messages/tr.json')).default,
  };

  return {
    getLocale: () => Promise.resolve(state.locale),
    getTranslations: (namespace: string) =>
      Promise.resolve(
        createTranslator({
          locale: state.locale,
          messages: catalogues[state.locale],
          namespace: namespace as never,
        }),
      ),
  };
});

const CATALOGUES = { az, en, ru, tr } as const;

const agreementMock = vi.mocked(fetchLegalDocument);
const feesMock = vi.mocked(fetchFeeDisclosure);

beforeEach(() => {
  agreementMock.mockReset();
  feesMock.mockReset();
  feesMock.mockResolvedValue(null);
});

afterEach(cleanup);

async function open(locale: Locale, query: Record<string, string | string[]> = {}) {
  state.locale = locale;
  return render(
    await resolveServerTree(
      await BackProjectPage({
        params: Promise.resolve({ id: 'p-1' }),
        searchParams: Promise.resolve(query),
      }),
    ),
  );
}

describe.each(SUPPORTED_LOCALES)('the checkout in %s', (locale) => {
  const copy = CATALOGUES[locale].checkout.agreementUnavailable;

  it('hands a published agreement’s version to the checkout', async () => {
    agreementMock.mockResolvedValue({
      state: 'published',
      document: {
        kind: 'BACKER_AGREEMENT',
        locale,
        version: 4,
        title: 'Backer agreement',
        body: 'Text.',
        contentHash: 'd'.repeat(64),
      } as never,
    });

    const { container } = await open(locale);

    expect(screen.getByTestId('checkout').textContent).toBe('agreement:4');
    expect(container.textContent).not.toContain(copy.title);
  });

  it('opens the checkout with no agreement when none is published', async () => {
    agreementMock.mockResolvedValue({ state: 'unpublished' });

    const { container } = await open(locale);

    expect(screen.getByTestId('checkout').textContent).toBe('agreement:null');
    expect(container.textContent).not.toContain(copy.title);
  });

  it('renders the failure state instead of a checkout when the agreement could not be read', async () => {
    agreementMock.mockResolvedValue({ state: 'unavailable' });

    const { container } = await open(locale);

    expect(screen.queryByTestId('checkout')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.title);
    expect(container.textContent).toContain(copy.body);
    expect(screen.getByRole('link', { name: copy.action }).getAttribute('href')).toMatch(
      /\/projects\/p-1\/back$/u,
    );
  });
});

describe('the retry from a failed agreement read', () => {
  it('keeps a private campaign’s tokens and the chosen tier, or the retry would be refused', async () => {
    agreementMock.mockResolvedValue({ state: 'unavailable' });

    await open('en', { token: ['abc', 'def'], reward: 'tier-2' });

    const href = screen.getByRole('link', { name: 'Try again' }).getAttribute('href') ?? '';
    expect(href).toMatch(/\/projects\/p-1\/back\?/u);

    const search = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(search.getAll('token')).toEqual(['abc', 'def']);
    expect(search.get('reward')).toBe('tier-2');
  });
});
