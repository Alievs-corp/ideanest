import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ApiError } from '../../lib/api/problem';
import { listRevisionQueue, type QueuedRevision } from '../../lib/admin/revisions';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { revisionQueueCopyFrom } from '../../lib/i18n/admin/revision-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { RevisionQueue } from './RevisionQueue';

const COPY = revisionQueueCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/revisions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/revisions')>()),
  listRevisionQueue: vi.fn(),
}));

const listMock = vi.mocked(listRevisionQueue);

const FIRST: QueuedRevision = {
  id: '0193f2a1-0000-7000-8000-00000000b001',
  projectId: '0193f2a1-0000-7000-8000-00000000c001',
  title: 'Cedar and Salt',
  slug: 'cedar-and-salt',
  creatorId: '0193f2a1-0000-7000-8000-00000000a001',
  creatorName: 'Ayan Mammadova',
  changedFields: ['title', 'story'],
  submittedAt: '2026-10-20T09:00:00Z',
};

const SECOND: QueuedRevision = {
  ...FIRST,
  id: '0193f2a1-0000-7000-8000-00000000b002',
  projectId: '0193f2a1-0000-7000-8000-00000000c002',
  title: 'Second Campaign',
  creatorName: null,
  changedFields: ['coverImage', 'countries'],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('the campaign edit queue — issue #560', () => {
  it('lists each edit with its creator, what changed and a named link to the review', async () => {
    listMock.mockResolvedValue({ revisions: [FIRST, SECOND] });

    render(<RevisionQueue copy={COPY} />);

    const row = (await screen.findByText('Cedar and Salt')).closest('li');
    if (row === null) throw new Error('no row');

    expect(within(row).getByText(fillPlaceholders(COPY.by, { name: 'Ayan Mammadova' }))).toBeInTheDocument();
    expect(within(row).getByText(COPY.fields.title)).toBeInTheDocument();
    expect(within(row).getByText(COPY.fields.story)).toBeInTheDocument();

    const link = within(row).getByRole('link', {
      name: fillPlaceholders(COPY.reviewLabel, { title: 'Cedar and Salt' }),
    });
    expect(link).toHaveAttribute('href', expect.stringContaining(`/admin/moderation/revisions/${FIRST.id}`));

    // An anonymised creator is said, not drawn as an empty name.
    expect(screen.getByText(fillPlaceholders(COPY.by, { name: COPY.creatorGone }))).toBeInTheDocument();
  });

  it('names an edit to items and shipping zones in words, not by the service field names', async () => {
    listMock.mockResolvedValue({ revisions: [{ ...FIRST, changedFields: ['items', 'shippingZones'] }] });

    render(<RevisionQueue copy={COPY} />);

    const row = (await screen.findByText('Cedar and Salt')).closest('li');
    if (row === null) throw new Error('no row');

    expect(within(row).getByText(COPY.fields.items)).toBeInTheDocument();
    expect(within(row).getByText(COPY.fields.shippingZones)).toBeInTheDocument();
    expect(within(row).queryByText('shippingZones')).not.toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    listMock.mockResolvedValue({ revisions: [] });

    render(<RevisionQueue copy={COPY} />);

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
  });

  it('renders the refusal for a caller without the capability', async () => {
    listMock.mockRejectedValue(new ApiError(403, { code: 'INSUFFICIENT_STAFF_CAPABILITY', meta: { capability: 'MODERATE_CONTENT' } }));

    render(<RevisionQueue copy={COPY} />);

    expect(await screen.findByText(/MODERATE_CONTENT/)).toBeInTheDocument();
  });

  it('offers to try again after a failure', async () => {
    listMock.mockRejectedValueOnce(new ApiError(500, { code: 'INTERNAL' }));
    listMock.mockResolvedValueOnce({ revisions: [FIRST] });

    render(<RevisionQueue copy={COPY} />);

    const retry = await screen.findByRole('button', { name: COPY.tryAgain });
    retry.click();

    expect(await screen.findByText('Cedar and Salt')).toBeInTheDocument();
  });
});
