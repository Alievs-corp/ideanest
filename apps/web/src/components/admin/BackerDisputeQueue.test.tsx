import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  decideBackerDispute,
  readBackerDisputeQueue,
  type BackerDispute,
} from '../../lib/admin/backer-disputes';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { backerDisputeQueueCopyFrom } from '../../lib/i18n/admin/money-copy';
import { translatorFor } from '../../test-copy';
import { BackerDisputeQueue } from './BackerDisputeQueue';

const COPY = backerDisputeQueueCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/backer-disputes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/backer-disputes')>()),
  readBackerDisputeQueue: vi.fn(),
  decideBackerDispute: vi.fn(),
}));

const readMock = vi.mocked(readBackerDisputeQueue);
const decideMock = vi.mocked(decideBackerDispute);

const DISPUTE: BackerDispute = {
  id: '0193f2a1-0000-7000-8000-00000000d001',
  pledgeId: '0193f2a1-0000-7000-8000-00000000a001',
  projectId: '0193f2a1-0000-7000-8000-00000000b001',
  payoutId: '0193f2a1-0000-7000-8000-00000000c001',
  reason: 'The reward was described differently when I backed it.',
  state: 'OPEN',
  openedAt: '2026-09-13T10:00:00Z',
};

beforeEach(() => {
  readMock.mockReset();
  decideMock.mockReset();
});

describe('the backer dispute queue', () => {
  it('shows the backer’s reason, and upholding asks before it refunds', async () => {
    readMock.mockResolvedValueOnce([DISPUTE]).mockResolvedValue([]);
    decideMock.mockResolvedValue({ ...DISPUTE, state: 'UPHELD' });
    const user = userEvent.setup();
    render(<BackerDisputeQueue copy={COPY} />);

    expect(await screen.findByText(DISPUTE.reason)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Note/), 'Checked against the campaign page.');

    await user.click(screen.getByRole('button', { name: COPY.uphold }));
    expect(decideMock).not.toHaveBeenCalled();
    expect(screen.getByText(COPY.confirmUphold)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: COPY.confirmNow }));

    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith(DISPUTE.id, 'UPHOLD', 'Checked against the campaign page.'),
    );
    // Decided, so the queue is read again.
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2));
  });

  it('rejects in one press, with no note sent as null', async () => {
    readMock.mockResolvedValue([DISPUTE]);
    decideMock.mockResolvedValue({ ...DISPUTE, state: 'REJECTED' });
    const user = userEvent.setup();
    render(<BackerDisputeQueue copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.reject }));

    await waitFor(() => expect(decideMock).toHaveBeenCalledWith(DISPUTE.id, 'REJECT', null));
  });

  it('says a refused refund left the dispute open', async () => {
    readMock.mockResolvedValue([DISPUTE]);
    decideMock.mockRejectedValue(new ApiError(409, { status: 409, code: 'DISPUTE_REFUND_FAILED' }));
    const user = userEvent.setup();
    render(<BackerDisputeQueue copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.uphold }));
    await user.click(screen.getByRole('button', { name: COPY.confirmNow }));

    expect(await screen.findByText(COPY.refundFailed)).toBeInTheDocument();
    expect(screen.getByText(DISPUTE.reason)).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    readMock.mockResolvedValue([]);
    render(<BackerDisputeQueue copy={COPY} />);

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
  });
});
