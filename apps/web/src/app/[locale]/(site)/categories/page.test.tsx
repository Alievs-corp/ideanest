import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fetchCategories } from '../../../../lib/api/server';
import CategoriesPage from './page';

/**
 * `/categories` when the service does not answer — issue #127.
 *
 * The sentence below the heading was typed into the page in English, so a reader of `/az`
 * met Azerbaijani navigation around an English apology on the one occasion the page had
 * something to apologise for. It is rendered here in Azerbaijani because English passing
 * would prove nothing: the typed sentence was English too.
 */

vi.mock('../../../../lib/api/server', () => ({ fetchCategories: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const CATALOGUE = (await import('@ideanest/messages/az.json')).default;

  return {
    getLocale: () => Promise.resolve('az'),
    getTranslations: (namespace: string) =>
      Promise.resolve(
        createTranslator({ locale: 'az', messages: CATALOGUE, namespace: namespace as never }),
      ),
  };
});

const fetchMock = vi.mocked(fetchCategories);

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(cleanup);

describe('the categories page when the taxonomy could not be read', () => {
  it('apologises in the route’s language, not in English', async () => {
    fetchMock.mockResolvedValue(null);

    const { container } = render(await CategoriesPage());

    expect(container.textContent).toContain('Kateqoriyalar hal-hazırda yüklənə bilmədi.');
    expect(container.textContent).not.toContain('could not be loaded');
  });

  it('still points the reader at the feed, from inside the translated sentence', async () => {
    fetchMock.mockResolvedValue(null);

    render(await CategoriesPage());

    expect(screen.getByRole('link', { name: 'Lent' }).getAttribute('href')).toMatch(/\/discover$/);
  });

  it('says the same thing for a taxonomy that is merely empty', async () => {
    fetchMock.mockResolvedValue([]);

    render(await CategoriesPage());

    expect(screen.getByRole('link', { name: 'Lent' })).toBeInTheDocument();
  });
});
