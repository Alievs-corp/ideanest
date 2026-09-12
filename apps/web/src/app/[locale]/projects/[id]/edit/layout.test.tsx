import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fetchSession } from '../../../../../lib/session/session';
import { SessionProvider } from '../../../../../components/session/SessionProvider';
import { EditorShell } from '../../../../../components/campaign-editor/EditorShell';
import { MAIN_CONTENT_ID } from '../../../../../components/shell/SkipLink';
import CampaignEditorLayout from './layout';
import NewProjectLayout from '../../new/layout';
import MESSAGES from '../../../../../../messages/en.json';
import { resolveServerTree } from '../../../../../test-support/server-tree';
import { EDITOR_COPY } from '../../../../../test-editor-copy';

/**
 * The campaign editor and the create form carry the site shell — issue #347.
 *
 * <h2>The landmark assertion is the one that earns this file</h2>
 *
 * `EditorShell` renders a `<header>` of its own — the campaign's title, its state and the
 * save indicator. HTML gives that element the `banner` role **unless it is descended from
 * `main`**, and until #347 it was, because every tab wrapped it in a `<main>` of its own.
 * Putting a shell above the editor and leaving those in place would have produced two
 * `main`s and two `banner`s at once, and neither is visible in a screenshot: a page with two
 * banners tells a screen-reader user there are two site headers to choose between.
 *
 * So the real editor is rendered here rather than a stand-in. A test that mounted a
 * paragraph would pass whether or not the header nesting was right, which is the only thing
 * this arrangement can get wrong.
 *
 * <h2>Motion is not asserted, and that is deliberate</h2>
 *
 * `docs/motion-system.md` §5 gives the editor "None — autosave indicator only" and gives the
 * shell "One — §4.7's collapse". The layout's docblock argues why those coexist; the
 * argument is about which row of a table the collapse is charged to, and a test cannot check
 * a budget's bookkeeping. Storybook and review own that.
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
  usePathname: () => '/projects/p1/edit/basics',
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

vi.mock('../../../../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../../../../lib/api/access-token', () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}));

const sessionMock = vi.mocked(fetchSession);

beforeEach(() => {
  sessionMock.mockReset();
  sessionMock.mockResolvedValue(null);
});

afterEach(cleanup);

async function renderInLayout(
  Layout: (props: { children: ReactNode }) => ReactNode,
  body: ReactNode,
) {
  const tree = await resolveServerTree(Layout({ children: body }));
  return render(<SessionProvider>{tree}</SessionProvider>);
}

describe('the campaign editor', () => {
  const editor = (
    <EditorShell projectId="p1" copy={EDITOR_COPY} active="basics" title="A solar lamp" state="DRAFT">
      <p>The basics form</p>
    </EditorShell>
  );

  it('renders inside the site header and footer', async () => {
    await renderInLayout(CampaignEditorLayout, editor);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByText('The basics form')).toBeInTheDocument();
    // The editor's own frame is still there and still names the campaign.
    expect(screen.getByRole('heading', { level: 1, name: 'A solar lamp' })).toBeInTheDocument();
  });

  it("keeps EditorShell's header out of the banner role by nesting it inside main", async () => {
    await renderInLayout(CampaignEditorLayout, editor);

    // One site header, not two. `getByRole` throws on more than one match, so this is the
    // assertion — the editor's `<header>` must stay generic.
    const banners = screen.getAllByRole('banner');
    expect(banners).toHaveLength(1);

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', MAIN_CONTENT_ID);

    // The one banner is the site header, OUTSIDE main. The editor's frame is inside it,
    // which is exactly what keeps `EditorShell`'s `<header>` generic.
    expect(mains[0]).not.toContainElement(banners[0] ?? null);
    expect(mains[0]).toContainElement(screen.getByRole('heading', { level: 1 }));

/*
 * The shell reads the catalogue on the server, so the frame under test is an async component.
 * These two mocks are what let it resolve here: the real `messages/en.json`, reached the way
 * `i18n/request.ts` reaches it, and `resolveServerTree` to await the component itself.
 */
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async (namespace: string) => (key: string) => {
    let node: unknown = MESSAGES;
    for (const segment of `${namespace}.${key}`.split('.')) {
      if (typeof node !== 'object' || node === null) throw new Error(`no message at ${key}`);
      node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node !== 'string') throw new Error(`no message at ${namespace}.${key}`);
    return node;
  },
}));

  });
});

describe('the create-a-campaign form', () => {
  it('renders inside the site header and footer, with one main', async () => {
    await renderInLayout(NewProjectLayout, <p>Give it a working title</p>);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', MAIN_CONTENT_ID);
  });
});
