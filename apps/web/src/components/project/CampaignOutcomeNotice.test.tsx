import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ProjectPageResponse } from '../../lib/api/server';
import { readCampaignPage, type CampaignPage } from '../../lib/projects/publicPage';
import { resolveServerTree } from '../../test-support/server-tree';
import { CampaignOutcomeNotice } from './CampaignOutcomeNotice';

/**
 * The outcome sentence in the reader's language — #155.
 *
 * It was "of a {goal} goal from {n} backers on {date}" in English, with a backer plural that was
 * `=== 1` and an ISO day. It is one ICU message now, and the backer count is a plural Russian
 * declines by its last digit — 1 бэкера, 2 бэкеров, 5 бэкеров, 21 бэкера after «от» — which is
 * exactly what an English-shaped test cannot see. Azerbaijani has one form, and its suffix has to
 * sit on the noun («dəstəkçidən», «tarixində»), never on a number or a date.
 */

const route = vi.hoisted(() => ({ locale: 'ru' as 'ru' | 'az' }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const CATALOGUES = {
    ru: (await import('@ideanest/messages/ru.json')).default,
    az: (await import('@ideanest/messages/az.json')).default,
  };

  return {
    getLocale: async () => route.locale,
    getTranslations: async (namespace: string) =>
      createTranslator({
        locale: route.locale,
        messages: CATALOGUES[route.locale],
        namespace: namespace as never,
      }),
  };
});

afterEach(() => {
  cleanup();
  route.locale = 'ru';
});

function closedWith(backersCount: number): CampaignPage {
  const page = readCampaignPage(
    {
      id: '0193f2a1-0000-7000-8000-000000000001',
      slug: 'coffee-table-book',
      state: 'SUCCESSFUL',
      title: 'A coffee table book',
      creator: { slug: 'ayan', name: 'Ayan Q' },
      goal: { amount: '10000.00', currency: 'AZN' },
      pledged: { amount: '12500.00', currency: 'AZN' },
      deadline: '2026-08-18T00:00:00Z',
      outcome: {
        goal: { amount: '10000.00', currency: 'AZN' },
        pledged: { amount: '12500.00', currency: 'AZN' },
        backersCount,
        finalisedAt: '2026-08-18T00:00:00Z',
      },
    } as ProjectPageResponse,
    'ayan',
    new Date('2026-08-19T12:00:00Z'),
  );
  if (page === null) throw new Error('The fixture is not a campaign');
  return page;
}

async function sentence(backers: number): Promise<string> {
  const { container } = render(await resolveServerTree(<CampaignOutcomeNotice campaign={closedWith(backers)} />));
  const paragraph = container.querySelector('p');
  return paragraph?.textContent ?? '';
}

describe('the outcome sentence in Russian', () => {
  it.each([
    [1, 'от 1 бэкера.'],
    [2, 'от 2 бэкеров.'],
    [5, 'от 5 бэкеров.'],
    [21, 'от 21 бэкера.'],
  ])('declines %i backers', async (backers, ending) => {
    const text = await sentence(backers);

    expect(text.startsWith('18 августа 2026 г. она собрала ')).toBe(true);
    expect(text.endsWith(ending)).toBe(true);
  });

  it('keeps the raised amount in bold', async () => {
    await sentence(5);

    expect(screen.getByText(/12[\s ,.]?500/, { selector: 'strong' })).toBeInTheDocument();
  });
});

describe('the outcome sentence in Azerbaijani', () => {
  it('puts every suffix on a noun', async () => {
    route.locale = 'az';
    const text = await sentence(3);

    expect(text.startsWith('18 avqust 2026 tarixində 3 dəstəkçidən ')).toBe(true);
    expect(text).toMatch(/ topladı; hədəfi .+ idi\.$/u);
  });
});
