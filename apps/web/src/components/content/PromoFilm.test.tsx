import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { promoFilm } from '@ideanest/messages/promo-film';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { PromoFilm } from './PromoFilm';

/**
 * The promo film on `/how-it-works` — issue #405.
 *
 * <p>What is pinned is what a render cannot be trusted to show: the 50 MB file is not fetched
 * until somebody asks for it, nothing starts by itself, and each language gets its own cut.
 */

const state = vi.hoisted(() => ({ locale: 'en' as Locale }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const catalogues = {
    az: (await import('@ideanest/messages/az.json')).default,
    en: (await import('@ideanest/messages/en.json')).default,
    ru: (await import('@ideanest/messages/ru.json')).default,
    tr: (await import('@ideanest/messages/tr.json')).default,
  };
  return {
    getTranslations: (namespace: string) =>
      Promise.resolve(
        createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as never }),
      ),
  };
});

const CATALOGUES = { az, en, ru, tr } as const;

afterEach(cleanup);

describe.each(SUPPORTED_LOCALES)('the promo film in %s', (locale) => {
  const copy = CATALOGUES[locale].static.howItWorks.film;

  it('shows the poster and fetches nothing until play is pressed', async () => {
    state.locale = locale;
    const { container } = render(await PromoFilm({ locale }));
    const video = container.querySelector('video');
    const film = promoFilm(locale);

    expect(video?.getAttribute('preload')).toBe('none');
    expect(video?.hasAttribute('autoplay')).toBe(false);
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.getAttribute('poster')).toBe(film.posterUrl);
    expect(video?.getAttribute('aria-label')).toBe(copy.label);
    expect(container.querySelector('source')?.getAttribute('src')).toBe(film.url);
    expect(screen.getByText(copy.title, { exact: false })).toBeTruthy();
  });
});

it('gives Turkish readers the English cut', async () => {
  state.locale = 'tr';
  const { container } = render(await PromoFilm({ locale: 'tr' }));
  expect(container.querySelector('source')?.getAttribute('src')).toMatch(/-en\.mp4$/);
});
