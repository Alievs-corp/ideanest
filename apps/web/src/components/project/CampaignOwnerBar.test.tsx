import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { fetchSession } from '../../lib/session/session';
import { translatorFor } from '../../test-copy';
import { SessionProvider } from '../session/SessionProvider';
import { CampaignOwnerBar, type CampaignOwnerBarCopy } from './CampaignOwnerBar';

/**
 * The creator's links on their own public page — #141.
 *
 * WHAT THESE COVER: the owner sees the dashboard and the editor; anybody else, signed in or
 * not, sees nothing; and a campaign that has not launched offers only the editor. The page
 * around it is cached for every reader, so the decision is the browser's, and these are the
 * cases that decision has.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/projects/aysel/open-thing',
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

const sessionMock = vi.mocked(fetchSession);

const t = translatorFor('campaign.owner');
const COPY: CampaignOwnerBarCopy = { label: t('label'), dashboard: t('dashboard'), edit: t('edit') };

function account(slug: string) {
  return { id: `id-${slug}`, email: `${slug}@example.com`, name: slug, slug, emailVerified: true };
}

function renderBar(dashboardHref: string | null = '/projects/project-1/dashboard') {
  return render(
    <SessionProvider>
      <p>page</p>
      <CampaignOwnerBar
        creatorSlug="aysel"
        editHref="/projects/project-1/edit/basics"
        dashboardHref={dashboardHref}
        copy={COPY}
      />
    </SessionProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the owner bar on a public campaign page', () => {
  it("gives the campaign's creator the dashboard and the editor", async () => {
    sessionMock.mockResolvedValue(account('aysel'));
    renderBar();

    const bar = await screen.findByRole('navigation', { name: COPY.label });
    expect(bar).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.dashboard })).toHaveAttribute(
      'href',
      expect.stringContaining('/projects/project-1/dashboard'),
    );
    expect(screen.getByRole('link', { name: COPY.edit })).toHaveAttribute(
      'href',
      expect.stringContaining('/projects/project-1/edit/basics'),
    );
  });

  it('draws nothing for another signed-in account', async () => {
    sessionMock.mockResolvedValue(account('someone-else'));
    renderBar();

    await waitFor(() => expect(sessionMock).toHaveBeenCalled());
    // Let the session settle; the bar must stay absent once it has.
    await screen.findByText('page');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('navigation', { name: COPY.label })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: COPY.dashboard })).not.toBeInTheDocument();
  });

  it('draws nothing for a reader who is not signed in', async () => {
    sessionMock.mockResolvedValue(null);
    renderBar();

    await waitFor(() => expect(sessionMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('navigation', { name: COPY.label })).not.toBeInTheDocument();
  });

  it('offers only the editor before launch', async () => {
    sessionMock.mockResolvedValue(account('aysel'));
    renderBar(null);

    await screen.findByRole('navigation', { name: COPY.label });
    expect(screen.getByRole('link', { name: COPY.edit })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: COPY.dashboard })).not.toBeInTheDocument();
  });
});
