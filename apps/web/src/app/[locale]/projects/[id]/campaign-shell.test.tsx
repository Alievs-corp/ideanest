import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fetchSession } from '../../../../lib/session/session';
import { SessionProvider } from '../../../../components/session/SessionProvider';
import { MAIN_CONTENT_ID } from '../../../../components/shell/SkipLink';
import CampaignPageLayout from './[projectSlug]/layout';
import PrelaunchPageLayout from './prelaunch/layout';
import MESSAGES from '../../../../../messages/en.json';
import { resolveServerTree } from '../../../../test-support/server-tree';

/**
 * The two public routes under `/projects/{id}` carry the site shell — issue #343.
 *
 * <h2>Why this is a test and not a screenshot review</h2>
 *
 * The campaign page shipped for months with no header and no footer, and nobody caught it,
 * because every screenshot of it was taken by somebody who already knew what the page was
 * and had arrived at it deliberately. What was missing is only missing to a stranger — the
 * reader who lands on a shared link and then wants to go somewhere else. `docs/ui-kit.md`
 * §8.6 makes the header and the footer part of the frame rather than part of any page, so
 * "is the frame there" is a structural question, and this is where it gets answered.
 *
 * The route matters more than most: `/projects/{creatorSlug}/{projectSlug}` is the address
 * every social post, every search result and every discovery card points at. It is the front
 * door for a reader who has never seen the platform before.
 *
 * <h2>The three assertions, and what each one is guarding</h2>
 *
 * <ol>
 *   <li><strong>A `banner` and a `contentinfo`.</strong> The literal regression: a layout
 *       chain that reaches the page without passing through `SiteShell` renders neither.
 *   <li><strong>Exactly one `main`.</strong> Both pages used to declare their own, and
 *       putting a shell above them without taking those away would trade a missing landmark
 *       for an ambiguous one — "jump to main" with two answers. `MinimalShell.test.tsx`
 *       guards the same property on the other shell.
 *   <li><strong>The skip link resolves.</strong> It is the first focusable element in the
 *       document and it points at that one `main`, which is what makes it a skip link rather
 *       than an anchor to nowhere.
 * </ol>
 *
 * <h2>What is deliberately NOT asserted here</h2>
 *
 * Nothing about `/projects/{id}/back`. The checkout must keep no site header —
 * `docs/ui-kit.md` §8.5 and `docs/motion-system.md` §5 — and a leaf layout per public
 * segment is what keeps it that way without a rule anybody has to remember. A test that
 * asserted the absence of chrome on the checkout would be asserting the shape of the
 * directory tree, which the tree already states.
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
  usePathname: () => '/projects/aysel/solar-lamp',
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

vi.mock('../../../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../../../lib/api/access-token', () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

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
  // The signed-out answer, because that is the reader this frame exists for.
  sessionMock.mockResolvedValue(null);
});

afterEach(cleanup);

/**
 * A stand-in for the page. The real campaign page reads six endpoints and the pre-launch page
 * is a client boundary that reads its own; neither is what is under test, and mounting either
 * would make this a test of the fetch mocks. What matters is what the layout puts AROUND its
 * children, so the child is a paragraph.
 */
async function renderInLayout(Layout: (props: { children: ReactNode }) => ReactNode) {
  const tree = await resolveServerTree(Layout({ children: <p>The campaign body</p> }));
  return render(<SessionProvider>{tree}</SessionProvider>);
}

describe.each([
  ['the campaign page', CampaignPageLayout],
  ['the pre-launch page', PrelaunchPageLayout],
])('%s', (_name, Layout) => {
  it('renders inside the site header and footer', async () => {
    await renderInLayout(Layout);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByText('The campaign body')).toBeInTheDocument();
  });

  it('has exactly one main landmark, and the skip link points at it', async () => {
    await renderInLayout(Layout);

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', MAIN_CONTENT_ID);

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      `#${MAIN_CONTENT_ID}`,
    );
  });
});
