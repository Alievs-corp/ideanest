import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CampaignRisks } from './CampaignRisks';
import { resolveServerTree } from '../../test-support/server-tree';
import { translatorFor } from '../../test-copy';

/**
 * The risks section's heading — issue #142.
 *
 * It was the English literal "Risks and challenges" in the route, on every campaign in every
 * language. The English assertion goes through `translatorFor` so it is about the wiring; the
 * Turkish one is the one that could not have passed before, because the literal was English.
 */

const route = vi.hoisted(() => ({ locale: 'en' as 'en' | 'tr' }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const CATALOGUES = {
    en: (await import('../../../messages/en.json')).default,
    tr: (await import('../../../messages/tr.json')).default,
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
  route.locale = 'en';
});

const RISKS = 'The moulds may arrive late.\nShipping to islands takes longer.';

describe('the risks section', () => {
  it('is headed with the catalogue’s words', async () => {
    render(await resolveServerTree(<CampaignRisks risks={RISKS} />));

    expect(
      screen.getByRole('region', { name: translatorFor('campaign.risks')('heading') }),
    ).toHaveTextContent('The moulds may arrive late.');
  });

  it('is headed in the route’s language, not in English', async () => {
    route.locale = 'tr';
    render(await resolveServerTree(<CampaignRisks risks={RISKS} />));

    expect(screen.getByRole('heading', { level: 2, name: 'Riskler ve zorluklar' })).toBeInTheDocument();
    expect(screen.queryByText('Risks and challenges')).not.toBeInTheDocument();
  });

  it('prints the creator’s text as text, never as markup', async () => {
    render(await resolveServerTree(<CampaignRisks risks="<b>not bold</b>" />));

    expect(screen.getByText('<b>not bold</b>')).toBeInTheDocument();
  });
});
