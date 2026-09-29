import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import { ACCOUNT_LINKS } from '../../lib/account/navigation';
import { AccountArea } from './AccountArea';

/**
 * The account frame's language scoping and its copy — §21.1, issues #324 and #275.
 *
 * WHAT THIS COVERS.
 *
 * The frame declares the language of the copy it resolved. That used to be an override of an
 * `<html lang="en">` the root layout hard-coded; since #123 the document carries the route's
 * own locale and this restates it. The assertion is unchanged and still worth making — it says
 * the element wrapping the translated navigation announces the language that navigation is
 * written in, which is what stops a screen reader pronouncing Russian with English phonetics,
 * and it is a defect nobody sees in a screenshot.
 *
 * It also covers the lookup itself, which moved here when the client provider was removed.
 * `AccountNav` is handed strings now, so this frame is the only place a key becomes a
 * sentence, and asking for the wrong one — `links.saved` instead of `links.saved.label` — is
 * a mistake no data test can catch. The assertions below are therefore about rendered output,
 * in all four languages, through the real catalogues.
 *
 * WHAT IT MOCKS, AND WHY.
 *
 *   - `next-intl/server`, because `getLocale()` and `getTranslations()` read a request-scoped
 *     store that only exists inside a Next render. The mock is the negotiated answer that
 *     `i18n/request.ts` would have produced, resolving against the real `messages/*.json` so
 *     that a wrong key fails here rather than rendering its own dotted name.
 *   - `next-intl`'s `NextIntlClientProvider`, as a marker that must never appear — see the
 *     page-weight test at the bottom.
 *   - `SiteShell`, down to a marker plus its children. The real one renders the header, the
 *     footer, and a session boundary — none of which this component decides anything about,
 *     and all of which would make a failure here ambiguous. What matters for the language
 *     claim is only that the shell's own chrome is *outside* the element carrying `lang`,
 *     and the stand-in below keeps that arrangement.
 */

let locale: Locale = 'en';

const CATALOGUES: Record<Locale, Record<string, unknown>> = { az, en, ru, tr };

/**
 * A dotted lookup over the real catalogue, standing in for next-intl's own.
 *
 * It throws where next-intl would fall back to the key. `i18n/request.ts` chooses that
 * fallback in production on purpose — a 500 on the settings page over one untranslated string
 * is worse than a wrong label — and that choice is only safe while something fails on the
 * wrong label instead. This is that something.
 */
function messageAt(namespace: string, key: string): string {
  const path = `${namespace}.${key}`;
  let node: unknown = CATALOGUES[locale];

  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) throw new Error(`no message at ${path}`);
    node = (node as Record<string, unknown>)[segment];
  }

  if (typeof node !== 'string') throw new Error(`no message at ${path} in ${locale}`);
  return node;
}

vi.mock('next-intl/server', () => ({
  getLocale: async () => locale,
  getTranslations: async (namespace: string) => (key: string) => messageAt(namespace, key),
}));

/*
 * Rendered instead of the real provider so its presence is observable. Nothing under this
 * frame imports it any more, so the factory below is never even evaluated — which is the
 * point: the day somebody puts the provider back, the marker appears and the last test fails.
 */
vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { readonly children: ReactNode }) => (
    <div data-testid="intl-client-provider">{children}</div>
  ),
}));

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/settings/notifications',
}));

vi.mock('../shell/SiteShell', () => ({
  SiteShell: ({ children }: { readonly children: ReactNode }) => (
    <div>
      <header data-testid="shell-chrome">IdeyaNest</header>
      {children}
      <footer data-testid="shell-chrome-footer">IdeyaNest</footer>
    </div>
  ),
}));

async function renderArea(at: Locale, children: ReactNode = <p>Panel</p>) {
  locale = at;
  return render(await AccountArea({ children }));
}

/** The element `lang` is expected on: the widest one this component owns. */
function wrapper(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[lang]');
  if (element === null) throw new Error('nothing in the account frame declares a language');
  return element;
}

describe('AccountArea', () => {
  it('declares the active language on the subtree it translates', async () => {
    for (const at of SUPPORTED_LOCALES) {
      const { container, unmount } = await renderArea(at);

      expect(wrapper(container).getAttribute('lang'), `lang for ${at}`).toBe(at);

      unmount();
    }
  });

  it('scopes the declaration below the shell, leaving the untranslated chrome alone', async () => {
    const { container } = await renderArea('ru');

    const scoped = wrapper(container);
    expect(scoped.contains(screen.getByTestId('shell-chrome'))).toBe(false);
    expect(scoped.contains(screen.getByTestId('shell-chrome-footer'))).toBe(false);
    expect(scoped).toContainElement(screen.getByRole('navigation', { name: ru.account.nav.label }));
    expect(scoped).toContainElement(screen.getByText('Panel'));
  });

  it('resolves the navigation labels, so they are drawn in that language', async () => {
    await renderArea('tr');

    expect(tr.account.links.saved.label).not.toBe(en.account.links.saved.label);
    expect(screen.getByRole('link', { name: tr.account.links.saved.label })).toHaveAttribute('href', '/en/account/saved');
  });

  it('leaves no key unresolved, and names the landmark, in all four languages', async () => {
    for (const at of SUPPORTED_LOCALES) {
      const { unmount } = await renderArea(at);

      /*
       * The landmark is found by its translated name rather than the English one. `aria-label`
       * is read aloud and never seen, so a name left in English is a defect only a
       * screen-reader user would ever meet.
       */
      const nav = screen.getByRole('navigation', { name: messageAt('account', 'nav.label') });

      expect(nav.textContent ?? '', `${at} renders no dotted key`).not.toMatch(
        /account\.(groups|links)\./,
      );

      for (const link of ACCOUNT_LINKS) {
        const label = messageAt('account', `links.${link.key}.label`);
        expect(
          screen.getByRole('link', { name: label }),
          `${at} links ${link.key}`,
        ).toHaveAttribute('href', `/en${link.href}`);
      }

      unmount();
    }
  });

  it('serialises no catalogue into the client payload', async () => {
    /*
     * This is a page-weight assertion, not a tidiness one. `NextIntlClientProvider` serialises
     * whatever it is given into the payload for the client boundary under it, and the version
     * of this frame that wrapped `AccountNav` in one put next-intl's client runtime plus the
     * whole `account` namespace into the First Load JS of every route in the area — sixteen
     * budgets over their ceiling at once, `/settings/sessions` by 27.4 KiB. The strings are
     * resolved on the server now and cross the boundary as props, so there is no provider here
     * to send anything, and the marker mocked above must not be in the tree.
     */
    await renderArea('en');

    expect(screen.queryByTestId('intl-client-provider')).toBeNull();
  });

  it('still renders the page it frames', async () => {
    await renderArea('en');

    expect(screen.getByText('Panel')).toBeInTheDocument();
  });
});
