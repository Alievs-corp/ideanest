import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { checkoutCopyFrom } from '../../lib/i18n/checkout-copy';
import { openBackerDispute, readDisputeWindow } from '../../lib/pledges/disputes';
import { translatorFor } from '../../test-copy';
import { BackerDisputeForm } from './BackerDisputeForm';

vi.mock('../../lib/pledges/disputes', () => ({ openBackerDispute: vi.fn(), readDisputeWindow: vi.fn() }));

const COPY = checkoutCopyFrom(translatorFor('checkout')).dispute;
const openMock = vi.mocked(openBackerDispute);
const windowMock = vi.mocked(readDisputeWindow);
const HELD = { status: 'OPEN', until: '2026-11-01T08:00:00Z', dispute: null } as const;

// A block, not an expression: a function returned from `beforeEach` is run as its teardown.
beforeEach(() => {
  openMock.mockReset();
  windowMock.mockReset();
  windowMock.mockResolvedValue(HELD);
});
afterEach(cleanup);

describe('disputing a paid pledge', () => {
  it('is one press away, sends the reason, and says an administrator decides', async () => {
    openMock.mockResolvedValue({} as Awaited<ReturnType<typeof openBackerDispute>>);
    const user = userEvent.setup();
    render(<BackerDisputeForm pledgeId="pledge-1" copy={COPY} locale="en" />);

    expect(screen.queryByLabelText(/What went wrong/)).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: COPY.heading }));

    await user.type(screen.getByLabelText(/What went wrong/), '  The reward never shipped.  ');
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    await waitFor(() => expect(openMock).toHaveBeenCalledWith('pledge-1', 'The reward never shipped.'));
    expect(await screen.findByText(COPY.opened)).toBeInTheDocument();
  });

  it('says until when the payout is held', async () => {
    render(<BackerDisputeForm pledgeId="pledge-1" copy={COPY} locale="en" />);

    expect(await screen.findByRole('button', { name: COPY.heading })).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('#480: offers no form before a payout is held, and says when one can be opened', async () => {
    windowMock.mockResolvedValue({ status: 'NOT_YET', until: null, dispute: null });
    render(<BackerDisputeForm pledgeId="pledge-1" copy={COPY} locale="en" />);

    expect(await screen.findByText(COPY.notYet)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.heading })).not.toBeInTheDocument();
  });

  it.each(['CLOSED', 'NOTHING_LEFT'] as const)('#480: offers nothing when the window is %s', async (status) => {
    windowMock.mockResolvedValue({ status, until: null, dispute: null });
    const { container } = render(<BackerDisputeForm pledgeId="pledge-1" copy={COPY} locale="en" />);

    await waitFor(() => expect(windowMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('#480: a dispute already open is shown as open, not offered again', async () => {
    windowMock.mockResolvedValue({ ...HELD, dispute: {} as Awaited<ReturnType<typeof openBackerDispute>> });
    render(<BackerDisputeForm pledgeId="pledge-1" copy={COPY} locale="en" />);

    expect(await screen.findByText(COPY.opened)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.heading })).not.toBeInTheDocument();
  });

  it('words a closed window when the window could not be read beforehand', async () => {
    windowMock.mockRejectedValue(new Error('offline'));
    openMock.mockRejectedValue(new ApiError(409, { status: 409, code: 'DISPUTE_WINDOW_CLOSED' }));
    const user = userEvent.setup();
    render(<BackerDisputeForm pledgeId="pledge-1" copy={COPY} locale="en" />);

    await user.click(await screen.findByRole('button', { name: COPY.heading }));
    await user.type(screen.getByLabelText(/What went wrong/), 'Too late?');
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(await screen.findByText(COPY.windowClosed)).toBeInTheDocument();
  });
});
