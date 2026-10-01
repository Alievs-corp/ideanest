import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { QueuedSubmission, SubmissionQueuePage } from '../../lib/moderation/api';
import { decideCampaign, listSubmissions } from '../../lib/moderation/api';
import { SubmissionQueue } from './SubmissionQueue';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { submissionQueueCopyFrom } from '../../lib/i18n/admin/content-copy';

/*
 * Copy built from `messages/en.json` through the same builder the route calls, for the
 * reason `src/test-copy.ts` gives: a suite that retyped the sentences would stay green
 * with the catalogue empty.
 */
const COPY = submissionQueueCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/moderation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/moderation/api')>();
  return {
    ...actual,
    listSubmissions: vi.fn(),
    decideCampaign: vi.fn(),
  };
});

const listSubmissionsMock = vi.mocked(listSubmissions);
const decideCampaignMock = vi.mocked(decideCampaign);

const PROJECT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const WAITING: QueuedSubmission = {
  cursor: 'cursor-0001',
  projectId: PROJECT_ID,
  title: 'Xari Bulbul Ceramics',
  slug: 'xari-bulbul-ceramics',
  state: 'SUBMITTED',
  waitingSince: daysAgo(9),
  note: null,
  creatorId: 'creator-0001',
  creatorName: 'Aysel Səfərova',
  creatorSlug: 'aysel-studio',
  goal: { amount: '5000.00', currency: 'AZN' },
};

function page(overrides: Partial<SubmissionQueuePage> = {}): SubmissionQueuePage {
  return { state: 'SUBMITTED', submissions: [WAITING], nextCursor: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  listSubmissionsMock.mockResolvedValue(page());
});

describe('the campaign review queue', () => {
  it('lists a campaign nobody reported, which is the gap it exists to close', async () => {
    render(<SubmissionQueue copy={COPY} />);

    // The whole point: reaching a submitted campaign used to require a report about it.
    expect(await screen.findByText('Xari Bulbul Ceramics')).toBeInTheDocument();
    expect(screen.getByText('Aysel Səfərova')).toBeInTheDocument();
    expect(listSubmissionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'SUBMITTED' }),
    );
  });

  it('links the campaign to the staff preview, because its public page is a 404 by construction', async () => {
    render(<SubmissionQueue copy={COPY} />);

    const link = await screen.findByRole('link', { name: 'Xari Bulbul Ceramics' });
    /*
     * #399, and the defect that epic was mostly about. This link pointed at
     * `/projects/{creatorSlug}/{slug}`, which for every campaign in this queue answers 404 —
     * a campaign awaiting review is not public, and that is what awaiting review means. So
     * the only route from "decide about this campaign" to "read this campaign" was broken,
     * and approval happened on a title, a creator's name and a goal figure.
     */
    expect(link).toHaveAttribute('href', expect.stringContaining('/admin/campaigns/'));
    // A new tab, so the queue and its filters survive the trip.
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('links the creator to their account, where their VÖEN and business card are read', async () => {
    render(<SubmissionQueue copy={COPY} />);

    const link = await screen.findByRole('link', { name: 'Aysel Səfərova' });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining(`/admin/users/${encodeURIComponent(WAITING.creatorId)}`),
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('says how long the campaign has been waiting', async () => {
    render(<SubmissionQueue copy={COPY} />);

    // The queue's one number. Everything else on the row is context for it.
    expect(await screen.findByText(/9/)).toBeInTheDocument();
  });

  it('renders the goal from the string the service sent, grouped', async () => {
    render(<SubmissionQueue copy={COPY} />);

    /*
     * §10.3: money crosses as a string and is never parsed into a float on the way to a
     * screen — `formatMoney` groups the digits without going through a number, which is why
     * it takes the amount as text.
     *
     * It was `${amount} ${currency}` until #403, on this screen and the campaign directory
     * and nowhere else, so a console that renders `63,286.79 AZN` on the payout file
     * rendered `28000.00 AZN` on the queue deciding whether that campaign may run.
     */
    expect(await screen.findByText('5,000.00 AZN')).toBeInTheDocument();
  });

  it('names a campaign whose creator has been anonymised rather than showing a blank', async () => {
    listSubmissionsMock.mockResolvedValue(
      page({ submissions: [{ ...WAITING, creatorName: null, creatorSlug: null }] }),
    );

    render(<SubmissionQueue copy={COPY} />);

    // §17.4 removes the person and leaves the campaign, so the row outlives its author.
    expect(await screen.findByText(COPY.creatorGone)).toBeInTheDocument();
    // Nobody is left to open, so the placeholder is not a link.
    expect(screen.queryByRole('link', { name: COPY.creatorGone })).not.toBeInTheDocument();
  });

  it('offers the three outcomes only where they can be reached', async () => {
    const user = userEvent.setup();
    render(<SubmissionQueue copy={COPY} />);
    await screen.findByText('Xari Bulbul Ceramics');

    expect(screen.getByRole('button', { name: COPY.moderation.campaignOutcome.approve })).toBeInTheDocument();

    listSubmissionsMock.mockResolvedValue(
      page({ state: 'APPROVED', submissions: [{ ...WAITING, state: 'APPROVED' }] }),
    );
    await user.click(screen.getByRole('button', { name: COPY.state.APPROVED }));

    // An approved campaign cannot be approved again, and a button that only produces a
    // 409 is a button that teaches people to distrust the screen.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: COPY.moderation.campaignOutcome.approve }),
      ).not.toBeInTheDocument(),
    );
  });

  it('does not decide anything until the dialog is confirmed', async () => {
    const user = userEvent.setup();
    render(<SubmissionQueue copy={COPY} />);
    await screen.findByText('Xari Bulbul Ceramics');

    await user.click(screen.getByRole('button', { name: COPY.moderation.campaignOutcome.approve }));

    // Every one of these is privileged, audited and hard to reverse. Opening the dialog
    // is not the decision.
    expect(decideCampaignMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('removes a campaign from the list once it has been decided', async () => {
    const user = userEvent.setup();
    decideCampaignMock.mockResolvedValue({
      id: PROJECT_ID,
      slug: 'xari-bulbul-ceramics',
      state: 'APPROVED',
      title: 'Xari Bulbul Ceramics',
    });

    render(<SubmissionQueue copy={COPY} />);
    await screen.findByText('Xari Bulbul Ceramics');

    await user.click(screen.getByRole('button', { name: COPY.moderation.campaignOutcome.approve }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: COPY.moderation.decision.verb.approve.confirmLabel }));

    await waitFor(() => expect(decideCampaignMock).toHaveBeenCalledWith(PROJECT_ID, 'approve', null));
    // It has left SUBMITTED, so it leaves a list the filter says is SUBMITTED.
    await waitFor(() => expect(screen.queryByText('Xari Bulbul Ceramics')).not.toBeInTheDocument());
  });

  it('says where the campaign actually is when somebody else decided it first', async () => {
    const user = userEvent.setup();
    decideCampaignMock.mockRejectedValue(
      new ApiError(409, {
        code: 'PROJECT_TRANSITION_NOT_ALLOWED',
        meta: { state: 'CHANGES_REQUESTED' },
      }),
    );

    render(<SubmissionQueue copy={COPY} />);
    await screen.findByText('Xari Bulbul Ceramics');

    await user.click(screen.getByRole('button', { name: COPY.moderation.campaignOutcome.approve }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: COPY.moderation.decision.verb.approve.confirmLabel }));

    // A shared queue means two moderators reach the same campaign, and "that did not
    // work" is less use than "it is already changes requested". Asserted as the whole
    // sentence rather than as /changes requested/i, which also matches the chip of that
    // name and finds two elements.
    expect(
      await screen.findByText(
        fillPlaceholders(COPY.transitionNotAllowedFrom, { state: 'changes requested' }),
      ),
    ).toBeInTheDocument();
    // Nothing was removed: the decision did not happen.
    expect(screen.getByText('Xari Bulbul Ceramics')).toBeInTheDocument();
  });

  it('explains a refusal rather than showing an empty queue', async () => {
    listSubmissionsMock.mockRejectedValue(new ApiError(403, { code: 'NOT_A_MODERATOR' }));

    render(<SubmissionQueue copy={COPY} />);

    // An empty list here would read as "nothing is waiting", which is the opposite of
    // what a 403 means.
    expect(await screen.findByText(COPY.forbiddenBody)).toBeInTheDocument();
  });

  it('asks the service for the next page rather than filtering a loaded one', async () => {
    const user = userEvent.setup();
    listSubmissionsMock.mockResolvedValue(page({ nextCursor: 'cursor-0001' }));

    render(<SubmissionQueue copy={COPY} />);
    await screen.findByText('Xari Bulbul Ceramics');

    await user.click(screen.getByRole('button', { name: COPY.loadMore }));

    // Keyset, because a moderator working the queue removes rows from it as they go and
    // an offset against a shifting set skips the campaigns waiting longest.
    await waitFor(() =>
      expect(listSubmissionsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ after: 'cursor-0001' }),
      ),
    );
  });
});
