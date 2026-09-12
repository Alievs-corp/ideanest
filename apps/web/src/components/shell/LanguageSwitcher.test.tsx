import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import en from '../../../messages/en.json';
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import { LanguageSwitcher } from './LanguageSwitcher';
import { expectNoViolations } from '../../test-axe';

/**
 * The footer's language control — issue #123's last mile.
 *
 * WHAT THESE COVER:
 *
 *   - all four languages are offered, each named in itself. The reader this control exists
 *     for is the one who landed in a language they cannot read, so a list translated into
 *     the current language would be a dead end for exactly that person.
 *   - each link goes to the SAME PAGE under another prefix, not to that language's home. A
 *     switcher that returns you to `/` loses the page you were reading, which on a campaign
 *     is the whole reason you were there.
 *   - the current language is marked `aria-current`, so the state is not carried by colour.
 *   - choosing writes the cookie, which is the one job `proxy.ts` left it: answering the
 *     bare path next time.
 */

const label = en.shell.footer.languageSwitcherLabel;

/** Swapped per render, standing in for the route's own `[locale]` segment and path. */
let locale: Locale = 'en';
let pathname = '/discover';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale }),
  usePathname: () => pathname,
}));

beforeEach(() => {
  locale = 'en';
  pathname = '/discover';
  /* Cookies persist across tests in one jsdom document; each case starts without one. */
  document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`;
});

afterEach(cleanup);

describe('the language switcher', () => {
  it('offers every supported language, each named in its own language', () => {
    render(<LanguageSwitcher label={label} />);

    const group = screen.getByRole('navigation', { name: label });
    expect(group).toBeInTheDocument();

    for (const [name, tag] of [
      ['Azərbaycan dili', 'az'],
      ['English', 'en'],
      ['Русский', 'ru'],
      ['Türkçe', 'tr'],
    ] as const) {
      const link = screen.getByRole('link', { name });
      expect(link, `${tag} is named in itself`).toHaveAttribute('lang', tag);
      expect(link).toHaveAttribute('hreflang', tag);
    }

    expect(screen.getAllByRole('link')).toHaveLength(SUPPORTED_LOCALES.length);
  });

  it.each(SUPPORTED_LOCALES)('keeps the page being read when switching from %s', (at) => {
    locale = at;
    pathname = `/${at}/projects/42/blueprint`;

    render(<LanguageSwitcher label={label} />);

    for (const target of SUPPORTED_LOCALES) {
      expect(
        screen.getByRole('link', { name: NAMES[target] }),
        `${at} → ${target} stays on the campaign`,
      ).toHaveAttribute('href', `/${target}/projects/42/blueprint`);
    }
  });

  it('points at the language home when the page being read is the home page', () => {
    locale = 'en';
    pathname = '/en';

    render(<LanguageSwitcher label={label} />);

    expect(screen.getByRole('link', { name: 'Русский' })).toHaveAttribute('href', '/ru');
  });

  it('marks the language being read, so the state is not carried by colour alone', () => {
    locale = 'ru';
    pathname = '/ru/discover';

    render(<LanguageSwitcher label={label} />);

    expect(screen.getByRole('link', { name: 'Русский' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'English' })).not.toHaveAttribute('aria-current');
  });

  it('remembers the choice, so the bare path redirects there next time', async () => {
    render(<LanguageSwitcher label={label} />);

    expect(document.cookie).not.toContain(`${LOCALE_COOKIE}=az`);

    await userEvent.click(screen.getByRole('link', { name: 'Azərbaycan dili' }));

    expect(document.cookie).toContain(`${LOCALE_COOKIE}=az`);
  });

  it('does not treat a campaign slug that looks like a language as one', () => {
    /*
     * `stripLocale` only removes the language it is given. A campaign at `/en/projects/az`
     * must not lose its slug on the way to Russian.
     */
    locale = 'en';
    pathname = '/en/projects/az';

    render(<LanguageSwitcher label={label} />);

    expect(screen.getByRole('link', { name: 'Русский' })).toHaveAttribute(
      'href',
      '/ru/projects/az',
    );
  });

  it('leaves no automatically detectable accessibility violation', async () => {
    const { container } = render(<LanguageSwitcher label={label} />);

    await expectNoViolations(container);
  });
});

const NAMES: Record<Locale, string> = {
  az: 'Azərbaycan dili',
  en: 'English',
  ru: 'Русский',
  tr: 'Türkçe',
};
