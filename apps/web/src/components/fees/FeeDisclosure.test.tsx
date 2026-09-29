import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import type { FeeDisclosure as Disclosure } from '../../lib/fees/server';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { FeeDisclosure } from './FeeDisclosure';

/**
 * The three answers a fee read can give, each with its own sentence — issue #145.
 *
 * <p>The defect: a failed read and an unconfigured schedule shared one branch, and the sentence
 * they shared says nothing is being deducted from pledges. During the 2026-09-28 outage that
 * told creators there was no fee while the platform charged one. The property pinned here is
 * the one the issue asks for — <strong>a failed read never says that nothing is deducted</strong>
 * — in all four languages, because a translation that kept the old sentence would be the same
 * defect in a language the English test does not read.
 */

const state = vi.hoisted(() => ({ locale: 'en' as Locale }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const catalogues = {
    az: (await import('../../../messages/az.json')).default,
    en: (await import('../../../messages/en.json')).default,
    ru: (await import('../../../messages/ru.json')).default,
    tr: (await import('../../../messages/tr.json')).default,
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

/** A catalogue sentence as it reads on the page, with its rich-text tags taken out. */
function plain(message: string): string {
  return message.replace(/<\/?[a-z]+>/gu, '');
}

const CONFIGURED: Disclosure = {
  configured: true,
  platformRate: '0.05000',
  processingRate: '0.02900',
  processingFixed: '0.0000',
  creatorReceivesRate: '0.92100',
  currency: 'AZN',
  effectiveFrom: '2026-03-01T00:00:00Z',
};

const UNCONFIGURED: Disclosure = {
  configured: false,
  platformRate: null,
  processingRate: null,
  processingFixed: null,
  creatorReceivesRate: null,
  currency: null,
  effectiveFrom: null,
};

async function draw(disclosure: Disclosure | null, locale: Locale, audience: 'backer' | 'creator') {
  state.locale = locale;
  return render(await FeeDisclosure({ disclosure, audience, locale }));
}

afterEach(cleanup);

describe.each(SUPPORTED_LOCALES)('the fee disclosure in %s', (locale) => {
  const copy = CATALOGUES[locale].fees.disclosure;

  it('states the rates when a schedule is configured', async () => {
    const { container } = await draw(CONFIGURED, locale, 'creator');
    const text = container.textContent ?? '';

    expect(text).toMatch(/5/u);
    expect(text).toMatch(/92[.,]1/u);
    expect(text).not.toContain(copy.unconfigured);
    expect(text).not.toContain(plain(copy.unavailable));
  });

  it('says nothing is deducted only when the service answered that nothing is configured', async () => {
    const { container } = await draw(UNCONFIGURED, locale, 'creator');
    const text = container.textContent ?? '';

    expect(text).toContain(copy.unconfigured);
    expect(text).not.toContain(plain(copy.unavailable));
  });

  it.each(['backer', 'creator'] as const)(
    'gives a failed read its own sentence, for a %s, and never the unconfigured one',
    async (audience) => {
      const { container } = await draw(null, locale, audience);
      const text = container.textContent ?? '';

      expect(text).toContain(plain(copy.unavailable));
      expect(text).not.toContain(copy.unconfigured);
      // No figure of any kind: the page does not know one.
      expect(text).not.toMatch(/\d/u);
    },
  );

  it('points a failed read at the creator agreement, where the rate is stated', async () => {
    await draw(null, locale, 'creator');

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toMatch(/\/legal\/creator-agreement$/u);
    expect(link.textContent).toBe(/<agreement>(.*)<\/agreement>/u.exec(copy.unavailable)?.[1]);
  });

  it('treats a configured answer without its rates as a failed read, not as nothing charged', async () => {
    const { container } = await draw(
      { ...CONFIGURED, platformRate: null, creatorReceivesRate: null },
      locale,
      'backer',
    );
    const text = container.textContent ?? '';

    expect(text).toContain(plain(copy.unavailable));
    expect(text).not.toContain(copy.unconfigured);
  });
});

describe('the failed-read sentence', () => {
  it('reads as a failure and disclaims "nothing charged" in English', async () => {
    const { container } = await draw(null, 'en', 'creator');

    expect(container.textContent).toContain('The fee could not be loaded just now.');
    expect(container.textContent).toContain('This does not mean that no fee is charged');
    expect(container.textContent).not.toMatch(/nothing is being deducted/iu);
  });

  it('reads as a failure in Azerbaijani, and names the agreement by its own name', async () => {
    const { container } = await draw(null, 'az', 'backer');

    expect(container.textContent).toContain('Komissiyanı hazırda yükləmək mümkün olmadı.');
    expect(container.textContent).not.toContain('heç nə tutulmur');
    expect(screen.getByRole('link').textContent).toBe('yaradıcı müqaviləsində');
  });
});
