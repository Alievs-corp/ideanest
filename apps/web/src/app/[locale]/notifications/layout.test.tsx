import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fetchSession } from '../../../lib/session/session';
import { SessionProvider } from '../../../components/session/SessionProvider';
import { MAIN_CONTENT_ID } from '../../../components/shell/SkipLink';
import NotificationsLayout from './layout';
import MESSAGES from '../../../../messages/en.json';
import { resolveServerTree } from '../../../test-support/server-tree';

/**
 * The inbox carries the site shell — issue #345.
 *
 * **This route is reached FROM the header.** `SiteHeader` draws a bell that links here, and
 * so do `AccountMenu` and `MobileNavDrawer`. A frame that disappears on arrival is therefore
 * not only a missing landmark, it is a control that appears to leave the site — and none of
 * that is visible in a screenshot of the inbox, because whoever takes one already knows where
 * they are. It is a structural question, so it is answered here.
 *
 * The three properties, and what each guards:
 *
 *   1. a `banner` and a `contentinfo` — the regression itself.
 *   2. exactly one `main` — the page declared its own before this layout existed, and a shell
 *      added above it without taking that away would trade a missing landmark for an
 *      ambiguous one. `MinimalShell.test.tsx` guards the same property on the other shell.
 *   3. the skip link points at that `main` — otherwise it is an anchor to nowhere.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/notifications',
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

vi.mock('../../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../../lib/api/access-token', () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

/*
 * The shell reads the catalogue on the server, so the frame under test is an async component.
 * These two mocks are what let it resolve here: the real `messages/en.json`, reached the way
 * `i18n/request.ts` reaches it, and `resolveServerTree` to await the component itself.
 */
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async (namespace: string) => {
    const at = (key: string): unknown => {
      let node: unknown = MESSAGES;
      for (const segment of `${namespace}.${key}`.split('.')) {
        if (typeof node !== 'object' || node === null) throw new Error(`no message at ${key}`);
        node = (node as Record<string, unknown>)[segment];
      }
      return node;
    };
    // `raw` for the templates a builder reads unformatted, as next-intl's translator has it.
    return Object.assign(
      (key: string) => {
        const node = at(key);
        if (typeof node !== 'string') throw new Error(`no message at ${namespace}.${key}`);
        return node;
      },
      { raw: at },
    );
  },
}));


const sessionMock = vi.mocked(fetchSession);

beforeEach(() => {
  sessionMock.mockReset();
  sessionMock.mockResolvedValue(null);
});

afterEach(cleanup);

/*
 * A paragraph stands in for the page. `InboxPanel` reads the inbox with a bearer token and is
 * not what is under test; mounting it would make this a test of the fetch mocks. What matters
 * is what the layout puts around whatever it is given.
 */
async function renderLayout() {
  const tree = await resolveServerTree(NotificationsLayout({ children: <p>The inbox</p> }));
  return render(<SessionProvider>{tree}</SessionProvider>);
}

describe('the notifications page', () => {
  it('renders inside the site header and footer', async () => {
    await renderLayout();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByText('The inbox')).toBeInTheDocument();
  });

  it('has exactly one main landmark, and the skip link points at it', async () => {
    await renderLayout();

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', MAIN_CONTENT_ID);

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      `#${MAIN_CONTENT_ID}`,
    );
  });
});
