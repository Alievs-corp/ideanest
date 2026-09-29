import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SUPPORTED_LOCALES, type Locale } from '../../../../lib/i18n/locale';
import { resolveServerTree } from '../../../../test-support/server-tree';
import type { LegalDocument } from '../../../../lib/legal/api';
import {
  fetchArchivedLegalDocument,
  fetchLegalCatalogue,
  fetchLegalDocument,
} from '../../../../lib/legal/server';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import LegalDocumentRoute from './[document]/page';
import ArchivedLegalDocumentRoute from './[document]/v/[version]/page';
import LegalIndexRoute from './page';

/**
 * The legal pages' three states — issue #147.
 *
 * <p>Published renders the document, the service's 404 renders "not published", and every other
 * failure renders the site's failure state. The last is the defect: during the 2026-09-28
 * outage `/legal/terms-of-use` said IdeyaNest had no terms of use. Each state is rendered in all
 * four languages, because the sentence a reader is given is the thing under test and a
 * translation carries it as much as the English does.
 */

const state = vi.hoisted(() => ({ locale: 'en' as Locale }));

vi.mock('../../../../lib/legal/server', () => ({
  fetchLegalDocument: vi.fn(),
  fetchArchivedLegalDocument: vi.fn(),
  fetchLegalCatalogue: vi.fn(),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const catalogues = {
    az: (await import('@ideanest/messages/az.json')).default,
    en: (await import('@ideanest/messages/en.json')).default,
    ru: (await import('@ideanest/messages/ru.json')).default,
    tr: (await import('@ideanest/messages/tr.json')).default,
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

const documentMock = vi.mocked(fetchLegalDocument);
const archiveMock = vi.mocked(fetchArchivedLegalDocument);
const catalogueMock = vi.mocked(fetchLegalCatalogue);

function documentIn(locale: Locale): LegalDocument {
  return {
    kind: 'TERMS_OF_USE',
    locale,
    version: 3,
    title: 'Published title',
    body: 'The first binding paragraph.',
    contentHash: 'c'.repeat(64),
    effectiveFrom: null,
    publishedAt: null,
  };
}

beforeEach(() => {
  documentMock.mockReset();
  archiveMock.mockReset();
  catalogueMock.mockReset();
});

afterEach(cleanup);

async function current(locale: Locale) {
  state.locale = locale;
  return render(
    await resolveServerTree(
      await LegalDocumentRoute({ params: Promise.resolve({ locale, document: 'terms-of-use' }) }),
    ),
  );
}

async function archived(locale: Locale) {
  state.locale = locale;
  return render(
    await resolveServerTree(
      await ArchivedLegalDocumentRoute({
        params: Promise.resolve({ locale, document: 'terms-of-use', version: '3' }),
      }),
    ),
  );
}

describe.each(SUPPORTED_LOCALES)('a legal document in %s', (locale) => {
  const copy = CATALOGUES[locale].legal;

  it('renders the published text', async () => {
    documentMock.mockResolvedValue({ state: 'published', document: documentIn(locale) });

    const { container } = await current(locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Published title');
    expect(container.textContent).toContain('The first binding paragraph.');
    expect(container.textContent).not.toContain(copy.unavailable.title);
  });

  it('says "not published" on the service’s 404', async () => {
    documentMock.mockResolvedValue({ state: 'unpublished' });

    const { container } = await current(locale);

    expect(container.textContent).toContain(copy.notPublished.summary);
    expect(container.textContent).not.toContain(copy.unavailable.title);
  });

  it('renders the failure state, not "not published", when the read failed', async () => {
    documentMock.mockResolvedValue({ state: 'unavailable' });

    const { container } = await current(locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.unavailable.title);
    expect(container.textContent).toContain(copy.unavailable.body);
    expect(container.textContent).not.toContain(copy.notPublished.summary);
    expect(container.textContent).not.toContain(copy.notPublished.body);

    const retry = screen.getByRole('link', { name: copy.unavailable.action });
    expect(retry.getAttribute('href')).toMatch(/\/legal\/terms-of-use$/u);
  });

  it('renders the failure state for an archived version that could not be read', async () => {
    archiveMock.mockResolvedValue({ state: 'unavailable' });

    const { container } = await archived(locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.unavailable.title);
    expect(screen.getByRole('link', { name: copy.unavailable.action }).getAttribute('href')).toMatch(
      /\/legal\/terms-of-use\/v\/3$/u,
    );
    expect(container.textContent).not.toContain(copy.notPublished.summary);
  });

  it('lists the documents when the catalogue is read', async () => {
    catalogueMock.mockResolvedValue([]);
    state.locale = locale;

    const { container } = render(
      await resolveServerTree(await LegalIndexRoute({ params: Promise.resolve({ locale }) })),
    );

    expect(container.textContent).toContain(copy.index.notPublished);
    expect(container.textContent).not.toContain(copy.unavailable.indexTitle);
  });

  it('renders the failure state on the index, never eight "not published" rows', async () => {
    catalogueMock.mockResolvedValue(null);
    state.locale = locale;

    const { container } = render(
      await resolveServerTree(await LegalIndexRoute({ params: Promise.resolve({ locale }) })),
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.unavailable.indexTitle);
    expect(container.textContent).not.toContain(copy.index.notPublished);
    expect(screen.getByRole('link', { name: copy.unavailable.action }).getAttribute('href')).toMatch(
      /\/legal$/u,
    );
  });
});

describe('an archived version the service does not have', () => {
  it('is still a real 404, because only the service’s 404 says a version does not exist', async () => {
    archiveMock.mockResolvedValue({ state: 'unpublished' });
    state.locale = 'en';

    await expect(
      ArchivedLegalDocumentRoute({
        params: Promise.resolve({ locale: 'en', document: 'terms-of-use', version: '9' }),
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('404') });
  });
});

describe('the failure state’s words', () => {
  it('say in English that the document could not be loaded, not that it is missing', async () => {
    documentMock.mockResolvedValue({ state: 'unavailable' });

    const { container } = await current('en');

    expect(container.textContent).toContain('This document could not be loaded');
    expect(container.textContent).not.toMatch(/has not been published/iu);
  });

  it('say the same in Azerbaijani', async () => {
    documentMock.mockResolvedValue({ state: 'unavailable' });

    const { container } = await current('az');

    expect(container.textContent).toContain('Bu sənədi yükləmək mümkün olmadı');
    expect(container.textContent).not.toContain('hələ dərc olunmayıb');
  });
});
