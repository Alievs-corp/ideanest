import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  approveRevision,
  readRevisionReview,
  rejectRevision,
  type ProjectEdit,
  type RevisionReview as Review,
} from '../../lib/admin/revisions';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { revisionReviewCopyFrom } from '../../lib/i18n/admin/revision-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { listCategories } from '../../lib/projects/api';
import { translatorFor } from '../../test-copy';
import { RevisionReview } from './RevisionReview';

const COPY = revisionReviewCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/revisions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/revisions')>()),
  readRevisionReview: vi.fn(),
  approveRevision: vi.fn(),
  rejectRevision: vi.fn(),
}));

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  listCategories: vi.fn(),
}));

const readMock = vi.mocked(readRevisionReview);
const approveMock = vi.mocked(approveRevision);
const rejectMock = vi.mocked(rejectRevision);
const categoriesMock = vi.mocked(listCategories);

const ID = '0193f2a1-0000-7000-8000-00000000b001';
const PROJECT = '0193f2a1-0000-7000-8000-00000000c001';
const CATEGORY = '0193f2a1-0000-7000-8000-00000000d001';
const OTHER_CATEGORY = '0193f2a1-0000-7000-8000-00000000d002';

const paragraph = (text: string) => ({ type: 'paragraph', spans: [{ text, marks: [] }] });
const story = (...blocks: unknown[]) => ({ version: 1, blocks }) as unknown as ProjectEdit['story'];

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: ID,
    projectId: PROJECT,
    status: 'PENDING',
    submittedAt: '2026-10-20T09:00:00Z',
    changedFields: ['title', 'story', 'category', 'countries', 'coverImage'],
    rewards: [],
    items: [],
    shippingZones: null,
    live: {
      title: 'Cedar and Salt',
      categoryId: CATEGORY,
      countries: ['AZ', 'TR'],
      coverImage: { url: 'https://img.test/old.jpg', width: 800, height: 450 },
      story: story(paragraph('Opening'), paragraph('The old middle'), paragraph('Closing')),
    },
    proposed: {
      title: 'Cedar and Sea Salt',
      categoryId: OTHER_CATEGORY,
      countries: ['AZ', 'GE'],
      coverImage: { url: 'https://img.test/new.jpg', width: 800, height: 450 },
      story: story(paragraph('Opening'), paragraph('The new middle'), paragraph('Closing')),
    },
    ...overrides,
  };
}

function renderReview() {
  return render(<RevisionReview revisionId={ID} copy={COPY} />);
}

async function pane(heading: string, field: string): Promise<HTMLElement> {
  return screen.findByRole('group', { name: `${heading}: ${field}` });
}

beforeEach(() => {
  vi.resetAllMocks();
  readMock.mockResolvedValue(review());
  categoriesMock.mockResolvedValue([
    { id: CATEGORY, slug: 'food', name: 'Food', subcategories: [] },
    { id: OTHER_CATEGORY, slug: 'crafts', name: 'Crafts', subcategories: [] },
  ]);
});

describe('the campaign edit review, issue #560', () => {
  it('shows live and proposed side by side for each changed field and marks the changes in words', async () => {
    renderReview();

    const live = await pane(COPY.liveHeading, COPY.fields.title);
    const proposed = await pane(COPY.proposedHeading, COPY.fields.title);

    // The word that arrived is underlined on the right with a spoken marker, and absent on the left.
    expect(within(live).queryByText('Sea', { exact: false })).not.toBeInTheDocument();
    const added = within(proposed).getByText('Sea', { exact: false });
    expect(added.tagName).toBe('INS');
    expect(added).toHaveTextContent(COPY.added);

    const storyLive = await pane(COPY.liveHeading, COPY.fields.story);
    const storyProposed = await pane(COPY.proposedHeading, COPY.fields.story);
    expect(within(storyLive).getByText('The old middle')).toBeInTheDocument();
    expect(within(storyProposed).getByText('The new middle')).toBeInTheDocument();
    expect(within(storyLive).queryByText('The new middle')).not.toBeInTheDocument();
  });

  it('names categories and countries rather than showing identifiers', async () => {
    renderReview();

    const category = await pane(COPY.proposedHeading, COPY.fields.category);
    await waitFor(() => expect(within(category).getByText('Crafts', { exact: false })).toBeInTheDocument());
    expect(
      within(await pane(COPY.liveHeading, COPY.fields.category)).getByText('Food', { exact: false }),
    ).toBeInTheDocument();

    const countries = await pane(COPY.proposedHeading, COPY.fields.countries);
    expect(within(countries).getByText('Georgia', { exact: false })).toBeInTheDocument();
    expect(
      within(await pane(COPY.liveHeading, COPY.fields.countries)).getByText('Türkiye', { exact: false }),
    ).toBeInTheDocument();
  });

  it('shows the before and after cover images with their own names', async () => {
    renderReview();

    const live = await pane(COPY.liveHeading, COPY.fields.coverImage);
    const proposed = await pane(COPY.proposedHeading, COPY.fields.coverImage);
    const alt = (title: string) => fillPlaceholders(COPY.coverAlt, { title });

    expect(within(live).getByRole('img', { name: alt('Cedar and Salt') })).toBeInTheDocument();
    expect(within(proposed).getByRole('img', { name: alt('Cedar and Sea Salt') })).toBeInTheDocument();
  });

  it('draws only the fields the service says changed', async () => {
    readMock.mockResolvedValue(review({ changedFields: ['title'] }));

    renderReview();

    await pane(COPY.liveHeading, COPY.fields.title);
    expect(
      screen.queryByRole('group', { name: `${COPY.liveHeading}: ${COPY.fields.story}` }),
    ).not.toBeInTheDocument();
  });

  it('draws the reward tiers an edit changes, and says nothing is missing when it changes only them', async () => {
    readMock.mockResolvedValue(
      review({
        changedFields: ['rewards'],
        rewards: [
          {
            id: '0193f2a1-0000-7000-8000-00000000a001',
            changes: ['deleted'],
            livePosition: 0,
            price: { amount: '10.00', currency: 'AZN' },
            changedFields: [],
            live: { title: 'Old bundle' },
            proposed: null,
          },
        ],
      }),
    );

    renderReview();

    const card = await screen.findByRole('article', {
      name: fillPlaceholders(COPY.rewards.tierLabel, { title: 'Old bundle' }),
    });
    expect(within(card).getByText(COPY.rewards.changes.deleted)).toBeInTheDocument();
    expect(screen.queryByText(COPY.noChanges)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: `${COPY.liveHeading}: ${COPY.fields.title}` }),
    ).not.toBeInTheDocument();
  });

  it('draws the items and shipping zones an edit changes, and says nothing is missing when it changes only them', async () => {
    readMock.mockResolvedValue(
      review({
        changedFields: ['items', 'shippingZones'],
        items: [
          {
            id: '0193f2a1-0000-7000-8000-00000000e001',
            changedFields: ['name'],
            live: { name: 'Mug', isDigital: false },
            proposed: { name: 'Enamel mug', isDigital: false },
          },
        ],
        shippingZones: {
          live: [],
          proposed: [{ id: '0193f2a1-0000-7000-8000-00000000f001', name: 'Caucasus', countryCodes: ['AZ', 'GE'] }],
        },
      }),
    );

    renderReview();

    expect(
      await screen.findByRole('article', { name: fillPlaceholders(COPY.items.itemLabel, { name: 'Mug' }) }),
    ).toBeInTheDocument();
    const zone = await screen.findByRole('article', {
      name: fillPlaceholders(COPY.shippingZones.zoneLabel, { name: 'Caucasus' }),
    });
    expect(within(zone).getByText(COPY.shippingZones.changes.added)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: COPY.fields.items })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: COPY.fields.shippingZones })).toBeInTheDocument();
    expect(screen.queryByText(COPY.noChanges)).not.toBeInTheDocument();
  });

  it('approves with no note, sends none, and then offers no more decisions', async () => {
    approveMock.mockResolvedValue({ id: ID, projectId: PROJECT, status: 'APPROVED' });
    const user = userEvent.setup();
    renderReview();

    await user.click(await screen.findByRole('button', { name: COPY.approve }));
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await user.click(within(dialog).getByRole('button', { name: COPY.approveDialog.confirmLabel }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(ID, null));
    expect(await screen.findByText(COPY.approved)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.approve })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.reject })).not.toBeInTheDocument();
  });

  it('refuses to reject without a note and sends it once there is one', async () => {
    rejectMock.mockResolvedValue({ id: ID, projectId: PROJECT, status: 'REJECTED' });
    const user = userEvent.setup();
    renderReview();

    await user.click(await screen.findByRole('button', { name: COPY.reject }));
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await user.click(within(dialog).getByRole('button', { name: COPY.rejectDialog.confirmLabel }));

    expect(await within(dialog).findByText(COPY.noteRequired)).toBeInTheDocument();
    expect(rejectMock).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole('textbox'), '  The new cover shows a different product.  ');
    await user.click(within(dialog).getByRole('button', { name: COPY.rejectDialog.confirmLabel }));

    await waitFor(() =>
      expect(rejectMock).toHaveBeenCalledWith(ID, 'The new cover shows a different product.'),
    );
    expect(await screen.findByText(COPY.rejected)).toBeInTheDocument();
  });

  it('tells the moderator the creator changed it on a 409 and reloads the revision', async () => {
    approveMock.mockRejectedValue(
      new ApiError(409, {
        status: 409,
        code: 'REVISION_NOT_AVAILABLE',
        title: 'Not available',
        meta: { reason: 'NOT_PENDING' },
      }),
    );
    const user = userEvent.setup();
    renderReview();

    await user.click(await screen.findByRole('button', { name: COPY.approve }));
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    readMock.mockResolvedValue(review({ status: 'DRAFT' }));
    await user.click(within(dialog).getByRole('button', { name: COPY.approveDialog.confirmLabel }));

    expect(await screen.findByText(COPY.unavailable)).toBeInTheDocument();
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // It is a draft again, so it cannot be decided.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: COPY.approve })).not.toBeInTheDocument(),
    );
  });

  it('keeps the dialog open with the refusal for any other failure', async () => {
    rejectMock.mockRejectedValue(
      new ApiError(500, { status: 500, code: 'INTERNAL', title: 'Broken', detail: 'Boom' }),
    );
    const user = userEvent.setup();
    renderReview();

    await user.click(await screen.findByRole('button', { name: COPY.reject }));
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await user.type(within(dialog).getByRole('textbox'), 'No.');
    await user.click(within(dialog).getByRole('button', { name: COPY.rejectDialog.confirmLabel }));

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('says so when the edit is gone', async () => {
    readMock.mockRejectedValue(new ApiError(404, { status: 404, code: 'NOT_FOUND', title: 'Not found' }));

    renderReview();

    expect(await screen.findByText(COPY.notFoundTitle)).toBeInTheDocument();
  });

  it('offers no decision on an edit that is not waiting', async () => {
    readMock.mockResolvedValue(review({ status: 'APPROVED' }));

    renderReview();

    expect(
      await screen.findByText(fillPlaceholders(COPY.notPending, { status: COPY.status.APPROVED ?? '' })),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.approve })).not.toBeInTheDocument();
  });
});
