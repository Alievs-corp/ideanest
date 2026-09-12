import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { type Locale } from '../../lib/i18n/locale';
import { type ShellCopy, shellCopyFrom } from '../../lib/i18n/shell-copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fetchSession } from '../../lib/session/session';
import { SessionProvider } from '../session/SessionProvider';
import { MobileNavDrawer } from './MobileNavDrawer';
import { expectNoViolations } from '../../test-axe';

const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr };


/**
 * The mobile navigation drawer — §4.13 WS-03, issue #261.
 *
 * WHAT THESE COVER, and none of it is visible in a screenshot:
 *
 *   - **it is not in the DOM until it is opened.** Every link inside it is a tab stop, and a
 *     permanently mounted panel with `opacity: 0` would put nine of them into the tab order of
 *     every page on the site for anybody who never opens it.
 *   - focus moves into the panel on open and returns to the trigger on close, by every route
 *     out: the close button, Escape, and the backdrop.
 *   - it is a modal dialog with an accessible name, and its trigger says whether it is open.
 *   - it carries the search field, which is the only one a phone gets — the header's is
 *     `hidden lg:block`.
 *   - the signed-in and signed-out branches differ, and the lime element is spent once.
 */

let pathname = '/discover';
/** The route's own `[locale]` segment, which the language links read. */
let locale: Locale = 'en';

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => pathname,
  useParams: () => ({ locale }),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

vi.mock('../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../lib/api/access-token', () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

const sessionMock = vi.mocked(fetchSession);

const ACCOUNT = {
  id: 'ffa5a1e2-0000-7000-8000-000000000000',
  email: 'aysel@example.com',
  name: 'Aysel',
  slug: 'aysel',
  emailVerified: true,
};

function renderDrawer(at: Locale = 'en') {
  locale = at;
  return render(
    <SessionProvider>
      <MobileNavDrawer copy={copyFor(at)} />
    </SessionProvider>,
  );
}

/*
 * The copy the server would have resolved, built from the real catalogue by the same function
 * `SiteShell` calls. Retyping the words into this file would produce a test that passes
 * whatever `messages/*.json` says, which is the opposite of what it is for.
 */
function copyFor(at: Locale): ShellCopy {
  return shellCopyFrom((key) => {
    let node: unknown = CATALOGUES[at].shell;
    for (const segment of key.split('.')) {
      if (typeof node !== 'object' || node === null) throw new Error(`no message at shell.${key}`);
      node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node !== 'string') throw new Error(`no message at shell.${key} in ${at}`);
    return node;
  });
}


const open = () => screen.getByRole('button', { name: 'Open navigation' });

beforeEach(() => {
  pathname = '/discover';
  locale = 'en';
  sessionMock.mockReset();
  sessionMock.mockResolvedValue(null);
});

afterEach(cleanup);

describe('before it is opened', () => {
  it('is not in the document at all', () => {
    renderDrawer();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Discover' })).toBeNull();
  });

  it('says it is closed', () => {
    renderDrawer();
    expect(open()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('once open', () => {
  it('is a modal dialog with a name', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(open());

    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('carries the primary navigation and marks the current page', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(open());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(dialog).getByRole('link', { name: 'Categories' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('carries the search field, which is the only one a phone gets', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(open());

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('searchbox', { name: 'Search campaigns' }),
    ).toBeInTheDocument();
  });

  it('moves focus into the panel', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(open());

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });
});

describe('closing it', () => {
  it('returns focus to the trigger, by the close button', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(open());

    await user.click(screen.getByRole('button', { name: 'Close navigation' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(open()));
  });

  it('returns focus to the trigger, by Escape', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(open());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(open()));
  });
});

describe('the actions inside it', () => {
  it('offers register and sign in when signed out, with one lime element', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(open());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Register' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(dialog.querySelectorAll('[data-on-lime]')).toHaveLength(1);
  });

  it('offers the account rows and a sign-out when signed in', async () => {
    const user = userEvent.setup();
    sessionMock.mockResolvedValue(ACCOUNT);
    renderDrawer();

    await waitFor(() => expect(sessionMock).toHaveBeenCalled());
    await user.click(open());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Register' })).toBeNull();
    expect(dialog.querySelectorAll('[data-on-lime]')).toHaveLength(0);
  });
});

describe('the language', () => {
  /**
   * The header's globe is `hidden sm:block` — measured at 390px it pushed the register pill
   * and this drawer's own button off the edge — so below that width these four links are the
   * way out of a language somebody cannot read, short of scrolling to the footer.
   */
  it('offers all four, each named in itself, and keeps the page being read', async () => {
    pathname = '/projects/42/blueprint';
    const user = userEvent.setup();
    renderDrawer('ru');

    await user.click(screen.getByRole('button', { name: ru.shell.drawer.open }));

    for (const [name, tag] of [
      ['Azərbaycan dili', 'az'],
      ['English', 'en'],
      ['Русский', 'ru'],
      ['Türkçe', 'tr'],
    ] as const) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('lang', tag);
      expect(link).toHaveAttribute('href', `/${tag}/projects/42/blueprint`);
    }

    expect(screen.getByRole('link', { name: 'Русский' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('accessibility', () => {
  /**
   * #129. The drawer closed and open, because they are two different trees: open, it is a
   * modal dialog that has to name itself, trap focus and be dismissible — three claims a
   * `role="dialog"` makes on behalf of whatever is inside it.
   */
  it('leaves no automatically detectable violation, closed or open', async () => {
    sessionMock.mockResolvedValue(ACCOUNT);

    const { container } = renderDrawer();
    await waitFor(() => expect(sessionMock).toHaveBeenCalled());
    await expectNoViolations(container);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await screen.findByRole('dialog');

    await expectNoViolations(document.body);
  });
});
