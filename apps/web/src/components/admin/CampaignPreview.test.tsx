import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiError } from '../../lib/api/problem';
import { readCampaignPreview } from '../../lib/admin/campaigns';
import type { CampaignPage } from '../../lib/projects/publicPage';
import { CampaignPreview } from './CampaignPreview';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { campaignPreviewCopyFrom } from '../../lib/i18n/admin/content-copy';
import { campaignStoryCopyFrom } from '../../lib/i18n/campaign-copy';

/*
 * Copy built from `messages/en.json` through the same builder the route calls, for the
 * reason `src/test-copy.ts` gives: a suite that retyped the sentences would stay green with
 * the catalogue empty.
 */
const COPY = campaignPreviewCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
  campaignStoryCopyFrom(translatorFor('campaign.story')),
);

vi.mock('../../lib/admin/campaigns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/campaigns')>();
  return { ...actual, readCampaignPreview: vi.fn() };
});

const readPreviewMock = vi.mocked(readCampaignPreview);

const PROJECT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

const SUBMITTED: CampaignPage = {
  id: PROJECT_ID,
  slug: 'xari-bulbul-ceramics',
  creatorSlug: 'aysel-studio',
  state: 'SUBMITTED',
  title: 'Xari Bulbul Ceramics',
  blurb: 'Hand-thrown pieces from a workshop in Şuşa.',
  creator: { slug: 'aysel-studio', name: 'Aysel Səfərova', avatarUrl: null },
  category: { slug: 'craft', name: 'Craft' },
  subcategory: null,
  coverImage: null,
  goal: { amount: '5000.00', currency: 'AZN' },
  pledged: { amount: '0.00', currency: 'AZN' },
  backersCount: 0,
  launchedAt: null,
  deadline: null,
  story: {
    version: 1,
    blocks: [
      { type: 'paragraph', spans: [{ text: 'Two thousand words about the kilns.', marks: [] }] },
    ],
  },
  risks: 'The main risk is manufacturing capacity.',
  outcome: null,
  completionPercent: null,
  daysLeft: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  readPreviewMock.mockResolvedValue(SUBMITTED);
});

/**
 * The staff preview — issue #399.
 *
 * <p>The submission queue asks for an irreversible decision about a campaign and linked to
 * the public page, which for a campaign in review is a 404 by construction. So approval
 * happened on a title, a creator's name and a goal figure, and everything the creator
 * actually wrote was reachable by nobody.
 */
describe('the campaign preview', () => {
  it('renders a campaign the public cannot see', async () => {
    render(<CampaignPreview projectId={PROJECT_ID} copy={COPY} />);

    expect(await screen.findByText('Xari Bulbul Ceramics')).toBeInTheDocument();
    expect(screen.getByText(COPY.state.SUBMITTED)).toBeInTheDocument();
    // The document the decision is actually about, through the same component the public
    // campaign page renders it with.
    expect(screen.getByText('Two thousand words about the kilns.')).toBeInTheDocument();
    expect(screen.getByText('The main risk is manufacturing capacity.')).toBeInTheDocument();
  });

  it('says what it is, before anything else', async () => {
    render(<CampaignPreview projectId={PROJECT_ID} copy={COPY} />);

    // This screen renders drafts. A member of staff who has lost track of which tab they
    // are in is one screenshot away from a problem, so the notice is not dismissible.
    expect(await screen.findByText(COPY.previewNoticeTitle)).toBeInTheDocument();
  });

  it('does not offer a public link for a campaign that has no public page', async () => {
    render(<CampaignPreview projectId={PROJECT_ID} copy={COPY} />);

    await screen.findByText('Xari Bulbul Ceramics');
    // Repeating the 404 in miniature is the one thing this screen must not do.
    expect(screen.queryByRole('link', { name: COPY.publicPage })).not.toBeInTheDocument();
    expect(screen.getByText(COPY.notPublicYet)).toBeInTheDocument();
  });

  it('offers the public link once the campaign has one', async () => {
    readPreviewMock.mockResolvedValue({ ...SUBMITTED, state: 'LIVE' });

    render(<CampaignPreview projectId={PROJECT_ID} copy={COPY} />);

    const link = await screen.findByRole('link', { name: COPY.publicPage });
    expect(link).toHaveAttribute('href', '/en/projects/aysel-studio/xari-bulbul-ceramics');
  });

  it('carries no decision controls, because they belong on the queue', async () => {
    render(<CampaignPreview projectId={PROJECT_ID} copy={COPY} />);

    await screen.findByText('Xari Bulbul Ceramics');
    /*
     * A preview that also carried decisions would be a second path into a state machine whose
     * single path is the reason the transition service exists. The only control on the screen
     * is the one that copies the campaign's identifier — #402's, and the thing that makes the
     * four screens taking a campaign id by hand reachable from here.
     */
    expect(screen.getAllByRole('button').map((control) => control.textContent)).toEqual([
      COPY.identity.copy,
    ]);
  });

  it('says a campaign is not there rather than rendering a page with holes in it', async () => {
    readPreviewMock.mockRejectedValue(new ApiError(404, null, 'No such campaign.'));

    render(<CampaignPreview projectId={PROJECT_ID} copy={COPY} />);

    expect(await screen.findByText(COPY.notFoundTitle)).toBeInTheDocument();
  });

  it('renders the console refusal rather than an empty screen for a caller who is not staff', async () => {
    readPreviewMock.mockRejectedValue(new ApiError(403, null, 'Not staff.'));

    render(<CampaignPreview projectId={PROJECT_ID} copy={COPY} />);

    // The route is not the gate — the service refuses, and this screen renders the refusal.
    expect(await screen.findByText(COPY.refusals.forbiddenTitle)).toBeInTheDocument();
  });
});
