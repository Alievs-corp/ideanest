import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SUPPORTED_LOCALES, type Locale } from '../../../../lib/i18n/locale';
import az from '../../../../../messages/az.json';
import en from '../../../../../messages/en.json';
import ru from '../../../../../messages/ru.json';
import tr from '../../../../../messages/tr.json';
import AboutPage from './page';

/**
 * `/about`'s cost section — issue #145.
 *
 * <p>It printed "15%… the creator receives 85%" from the catalogue while `/pricing` read the
 * rate in force from `fee_schedules`, so the day the rate changed the two pages would have
 * disagreed. The fix is that About states no rate and links to Pricing; what is pinned here is
 * that no language carries a percentage back in, and that the link is there to follow.
 */

const state = vi.hoisted(() => ({ locale: 'en' as Locale }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const catalogues = {
    az: (await import('../../../../../messages/az.json')).default,
    en: (await import('../../../../../messages/en.json')).default,
    ru: (await import('../../../../../messages/ru.json')).default,
    tr: (await import('../../../../../messages/tr.json')).default,
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

afterEach(cleanup);

describe.each(SUPPORTED_LOCALES)('the About page in %s', (locale) => {
  const cost = CATALOGUES[locale].static.about.cost;

  it('states no fee rate that could contradict Pricing', async () => {
    state.locale = locale;
    render(await AboutPage());

    // The cost section as drawn: its heading, the list below it and the note after that. The
    // 80% success threshold elsewhere on the page is a rule, not a rate, and is not this issue.
    const heading = screen.getByRole('heading', { name: cost.heading });
    const list = heading.nextElementSibling;
    const note = list?.nextElementSibling;

    expect(list?.tagName).toBe('UL');
    expect(note?.textContent).toBe(cost.note);
    expect(`${list?.textContent ?? ''} ${note?.textContent ?? ''}`).not.toMatch(/\d/u);
    for (const message of Object.values(cost)) {
      expect(message).not.toMatch(/\d/u);
    }
  });

  it('links the cost section to Pricing, where the rate in force is read', async () => {
    state.locale = locale;
    render(await AboutPage());

    const name = /<pricing>(.*)<\/pricing>/u.exec(cost.successful)?.[1];
    expect(name).toBeTruthy();

    const link = screen.getByRole('link', { name });
    expect(link.getAttribute('href')).toMatch(/\/pricing$/u);
  });
});
