import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { translatorFor } from '../../test-copy';
import type { ProfileProjectCard } from '../../lib/profiles/api';
import { listMyProjects } from '../../lib/projects/mine';
import { MyCampaignsPanel, type MyCampaignsPanelCopy } from './MyCampaignsPanel';

/**
 * `/account/campaigns` — the screen a creator reaches their own unfinished work from.
 *
 * WHAT THESE COVER:
 *
 *   - **a draft points at the editor and a live campaign points at its page.** This is the
 *     property the screen exists for. `/projects/{creator}/{slug}` answers 404 for a draft,
 *     so a list that sent every row there would be a list of dead links to exactly the
 *     campaigns nobody could otherwise find — the bug this page was built to fix, restored.
 *   - **the state is rendered as a word.** docs/ui-kit.md §9.2 forbids colour from carrying
 *     meaning alone, and "submitted" and "changes requested" are a fortnight apart in what
 *     the creator should do next.
 *   - the empty state offers the way out rather than an apology, and it is the *empty* state
 *     rather than the failure one — a creator who has started nothing has not hit an error.
 */

vi.mock('../../lib/projects/mine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/mine')>()),
  listMyProjects: vi.fn(),
}));

const listMock = vi.mocked(listMyProjects);

const COPY: MyCampaignsPanelCopy = {
  emptyTitle: 'No campaigns yet',
  emptyBody: 'Campaigns you start stay here.',
  startCampaign: 'Start a campaign',
  loadFailed: 'That list did not load',
  loadingList: 'Loading your campaigns',
  loadMore: 'Show more',
  loadingMore: 'Loading',
  draftHint: 'Not published yet',
  ...(() => {
    const t = translatorFor('account.pages.campaigns');
    return {
      view: t('view'),
      edit: t('edit'),
      dashboard: t('dashboard'),
      actionsLabel: String(t.raw('actionsLabel')),
    };
  })(),
  states: {
    DRAFT: 'Draft',
    LIVE: 'Live',
    PRELAUNCH: 'Pre-launch',
    SUSPENDED: 'Suspended',
    CHANGES_REQUESTED: 'Changes requested',
  },
};

/** The group of links a launched row carries, found by the name its label gives it. */
function actionsOf(title: string): HTMLElement {
  return screen.getByRole('group', {
    name: COPY.actionsLabel.replace('{title}', title),
  });
}

function card(id: string, title: string, state: string): ProfileProjectCard {
  return {
    id,
    title,
    slug: `slug-${id}`,
    creatorSlug: 'aysel',
    blurb: null,
    state,
    goal: null,
    pledged: null,
    backersCount: 0,
    deadline: null,
    launchedAt: null,
    coverImage: null,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the campaigns on an account', () => {
  it('sends a draft to the editor and a live campaign to its public page', async () => {
    listMock.mockResolvedValue({
      items: [card('draft-id', 'Unfinished thing', 'DRAFT'), card('live-id', 'Open thing', 'LIVE')],
      nextCursor: null,
    });

    render(<MyCampaignsPanel copy={COPY} />);

    /*
     * The pair, in one assertion each. A draft has no public address at all, so the two
     * hrefs differing is the whole contract of this list — and a single-row test would pass
     * with both wired to the same builder.
     */
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Unfinished thing/u })).toHaveAttribute(
        'href',
        expect.stringContaining('/projects/draft-id/edit/basics'),
      ),
    );
    expect(within(actionsOf('Open thing')).getByRole('link', { name: COPY.view })).toHaveAttribute(
      'href',
      expect.stringContaining('/projects/aysel/slug-live-id'),
    );
  });

  it('gives a launched campaign its dashboard beside its page (#141)', async () => {
    listMock.mockResolvedValue({ items: [card('live-id', 'Open thing', 'LIVE')], nextCursor: null });

    render(<MyCampaignsPanel copy={COPY} />);

    await waitFor(() => expect(actionsOf('Open thing')).toBeInTheDocument());
    expect(within(actionsOf('Open thing')).getByRole('link', { name: COPY.dashboard })).toHaveAttribute(
      'href',
      expect.stringContaining('/projects/live-id/dashboard'),
    );
  });

  it('gives a suspended campaign the editor and the dashboard, since it has no public page', async () => {
    listMock.mockResolvedValue({ items: [card('held-id', 'Paused thing', 'SUSPENDED')], nextCursor: null });

    render(<MyCampaignsPanel copy={COPY} />);

    await waitFor(() => expect(actionsOf('Paused thing')).toBeInTheDocument());
    const actions = within(actionsOf('Paused thing'));
    expect(actions.getByRole('link', { name: COPY.edit })).toHaveAttribute(
      'href',
      expect.stringContaining('/projects/held-id/edit/basics'),
    );
    expect(actions.getByRole('link', { name: COPY.dashboard })).toBeInTheDocument();
  });

  it('offers no dashboard before launch: drafts and pre-launch pages keep one link', async () => {
    listMock.mockResolvedValue({
      items: [card('draft-id', 'Unfinished thing', 'DRAFT'), card('soon-id', 'Coming thing', 'PRELAUNCH')],
      nextCursor: null,
    });

    render(<MyCampaignsPanel copy={COPY} />);

    await waitFor(() => expect(screen.getByRole('link', { name: /Unfinished thing/u })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Coming thing/u })).toHaveAttribute(
      'href',
      expect.stringContaining('/projects/aysel/slug-soon-id'),
    );
    expect(screen.queryByRole('link', { name: COPY.dashboard })).not.toBeInTheDocument();
  });

  it('says what state each campaign is in, in words', async () => {
    listMock.mockResolvedValue({
      items: [card('one', 'Waiting on moderation', 'CHANGES_REQUESTED')],
      nextCursor: null,
    });

    render(<MyCampaignsPanel copy={COPY} />);

    // §9.2: the state must survive being read aloud and being read by somebody who cannot
    // separate two greens.
    await waitFor(() => expect(screen.getByText('Changes requested')).toBeInTheDocument());
  });

  it('marks a campaign that is not published yet, since its row leads somewhere different', async () => {
    listMock.mockResolvedValue({ items: [card('one', 'Quiet draft', 'DRAFT')], nextCursor: null });

    render(<MyCampaignsPanel copy={COPY} />);

    await waitFor(() => expect(screen.getByText('Not published yet')).toBeInTheDocument());
  });

  it('offers the way out when there is nothing here, rather than an apology', async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });

    render(<MyCampaignsPanel copy={COPY} />);

    // Empty and not failed. A creator who has started nothing has not hit an error, and a
    // panel that could not tell the two apart would say so to the wrong person.
    await waitFor(() => expect(screen.getByText('No campaigns yet')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Start a campaign' })).toBeInTheDocument();
    expect(screen.queryByText('That list did not load')).not.toBeInTheDocument();
  });
});
