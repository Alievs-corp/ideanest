import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SUPPORT_EMAIL, SUPPORT_PHONE, displayPhone } from '@ideanest/messages/contact';
import { SUPPORTED_LOCALES, type Locale } from '../../../../lib/i18n/locale';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import SupportPage from './page';

/**
 * `/support` — issue #325. The store listings point here, so what is pinned is what a reviewer
 * and a person locked out of their account both need: an address that opens a mail client, a
 * number that dials, and a deletion section at the anchor Google Play is given.
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

describe.each(SUPPORTED_LOCALES)('the support page in %s', (locale) => {
  const copy = CATALOGUES[locale].static.support;

  it('gives the support address and phone as links that open a mail client and dial', async () => {
    state.locale = locale;
    render(await SupportPage());

    const email = screen.getAllByRole('link', { name: SUPPORT_EMAIL });
    expect(email[0]?.getAttribute('href')).toBe(`mailto:${SUPPORT_EMAIL}`);

    const phone = screen.getByRole('link', { name: displayPhone(SUPPORT_PHONE) });
    expect(phone.getAttribute('href')).toBe(`tel:${SUPPORT_PHONE}`);
  });

  it('puts account deletion under the anchor the Play listing is given', async () => {
    state.locale = locale;
    const { container } = render(await SupportPage());

    const heading = screen.getByRole('heading', { name: copy.deletion.heading });
    expect(heading.id).toBe('delete-account');
    expect(container.querySelectorAll('#delete-account')).toHaveLength(1);
  });

  it('offers deletion without signing in, by email with the subject filled in', async () => {
    state.locale = locale;
    render(await SupportPage());

    const subject = encodeURIComponent(copy.deletion.subject);
    const request = screen
      .getAllByRole('link', { name: SUPPORT_EMAIL })
      .find((link) => link.getAttribute('href')?.endsWith(`?subject=${subject}`));
    expect(request).toBeDefined();
    // The subject the link fills in is also written out, for a reader copying it by hand.
    expect(document.body.textContent).toContain(copy.deletion.subject);
  });

  it('links to the signed-in closure page and the pages that answer most questions', async () => {
    state.locale = locale;
    render(await SupportPage());

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    for (const path of [
      '/settings/privacy',
      '/how-it-works',
      '/pricing',
      '/trust-safety',
      '/legal',
      '/legal/privacy-policy',
    ]) {
      expect(hrefs.some((href) => href.endsWith(path)), path).toBe(true);
    }
  });
});
