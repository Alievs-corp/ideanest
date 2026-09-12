import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import en from '../../../messages/en.json';
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import { LanguageSwitcher } from './LanguageSwitcher';
import { expectNoViolations } from '../../test-axe';

/**
 * The language control — issue #123's last mile, now an icon in both the header and the
 * footer.
 *
 * WHAT THESE COVER:
 *
 *   - **the panel is not in the document until it is opened.** Four links on every page of
 *     the site, twice over now that the header carries one too, would be eight tab stops
 *     before the content for everybody who never changes language.
 *   - the trigger is icon-only, so it has to carry a name (§9.2), and it says whether the
 *     panel is open.
 *   - all four languages are offered, each named in itself. The reader this control exists
 *     for is the one who landed in a language they cannot read, so a list translated into
 *     the current language would be a dead end for exactly that person.
 *   - each link goes to the SAME PAGE under another prefix, not to that language's home. A
 *     switcher that returns you to `/` loses the page you were reading, which on a campaign
 *     is the whole reason you were there.
 *   - the current language is marked `aria-current` AND with a tick, so the state is not
 *     carried by colour.
 *   - choosing writes the cookie, which is the one job `proxy.ts` left it: answering the
 *     bare path next time.
 *   - Escape and a press outside close it, because a menu that only closes by choosing
 *     something forces a choice nobody asked for.
 */

const label = en.shell.language.label;

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

const trigger = () => screen.getByRole('button', { name: label });

/** Renders and opens the panel, which is where every link assertion below lives. */
async function open() {
  const result = render(<LanguageSwitcher label={label} />);
  await userEvent.click(trigger());
  return result;
}

describe('before it is opened', () => {
  it('is one named control and no links', () => {
    render(<LanguageSwitcher label={label} />);

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('leaves no automatically detectable accessibility violation', async () => {
    const { container } = render(<LanguageSwitcher label={label} />);

    await expectNoViolations(container);
  });
});

describe('the language panel', () => {
  it('offers every supported language, each named in its own language', async () => {
    await open();

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('navigation', { name: label });

    for (const [name, tag] of [
      ['Azərbaycan dili', 'az'],
      ['English', 'en'],
      ['Русский', 'ru'],
      ['Türkçe', 'tr'],
    ] as const) {
      const link = screen.getByRole('link', { name });
      expect(link, `${tag} is named in itself`).toHaveAttribute('lang', tag);
      expect(link).toHaveAttribute('hreflang', tag);
      expect(group).toContainElement(link);
    }

    expect(screen.getAllByRole('link')).toHaveLength(SUPPORTED_LOCALES.length);
  });

  it.each(SUPPORTED_LOCALES)('keeps the page being read when switching from %s', async (at) => {
    locale = at;
    pathname = `/${at}/projects/42/blueprint`;

    await open();

    for (const target of SUPPORTED_LOCALES) {
      expect(
        screen.getByRole('link', { name: NAMES[target] }),
        `${at} → ${target} stays on the campaign`,
      ).toHaveAttribute('href', `/${target}/projects/42/blueprint`);
    }
  });

  it('points at the language home when the page being read is the home page', async () => {
    locale = 'en';
    pathname = '/en';

    await open();

    expect(screen.getByRole('link', { name: 'Русский' })).toHaveAttribute('href', '/ru');
  });

  it('marks the language being read, and not with colour alone', async () => {
    locale = 'ru';
    pathname = '/ru/discover';

    const { container } = await open();

    const current = screen.getByRole('link', { name: 'Русский' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'English' })).not.toHaveAttribute('aria-current');

    /* The tick, which is what makes the state visible to somebody who cannot see the
     * difference between white and white at 64%. */
    expect(current.querySelector('svg')).not.toBeNull();
    expect(
      screen.getByRole('link', { name: 'English' }).querySelector('svg'),
      'only the current language is ticked',
    ).toBeNull();

    await expectNoViolations(container);
  });

  it('remembers the choice, so the bare path redirects there next time', async () => {
    await open();

    expect(document.cookie).not.toContain(`${LOCALE_COOKIE}=az`);

    await userEvent.click(screen.getByRole('link', { name: 'Azərbaycan dili' }));

    expect(document.cookie).toContain(`${LOCALE_COOKIE}=az`);
  });

  it('does not treat a campaign slug that looks like a language as one', async () => {
    /*
     * `stripLocale` only removes the language it is given. A campaign at `/en/projects/az`
     * must not lose its slug on the way to Russian.
     */
    locale = 'en';
    pathname = '/en/projects/az';

    await open();

    expect(screen.getByRole('link', { name: 'Русский' })).toHaveAttribute(
      'href',
      '/ru/projects/az',
    );
  });
});

describe('dismissing it', () => {
  it('closes on Escape', async () => {
    await open();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('link')).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a press outside, and not on one inside', async () => {
    await open();

    await userEvent.click(screen.getByRole('navigation', { name: label }));
    expect(screen.getAllByRole('link')).toHaveLength(SUPPORTED_LOCALES.length);

    await userEvent.click(document.body);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('closes when the trigger is pressed again', async () => {
    await open();

    await userEvent.click(trigger());

    expect(screen.queryByRole('link')).toBeNull();
  });
});

const NAMES: Record<Locale, string> = {
  az: 'Azərbaycan dili',
  en: 'English',
  ru: 'Русский',
  tr: 'Türkçe',
};
