import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { checkoutCopyFrom } from '../../lib/i18n/checkout-copy';
import { openBackerDispute } from '../../lib/pledges/disputes';
import { translatorFor } from '../../test-copy';
import { BackerDisputeForm } from './BackerDisputeForm';

vi.mock('../../lib/pledges/disputes', () => ({ openBackerDispute: vi.fn() }));

const COPY = checkoutCopyFrom(translatorFor('checkout')).dispute;
const openMock = vi.mocked(openBackerDispute);

// A block, not an expression: a function returned from `beforeEach` is run as its teardown.
beforeEach(() => {
  openMock.mockReset();
});
afterEach(cleanup);

describe('disputing a paid pledge', () => {
  it('is one press away, sends the reason, and says an administrator decides', async () => {
    openMock.mockResolvedValue({} as Awaited<ReturnType<typeof openBackerDispute>>);
    const user = userEvent.setup();
    render(<BackerDisputeForm pledgeId="pledge-1" copy={COPY} />);

    expect(screen.queryByLabelText(/What went wrong/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.heading }));

    await user.type(screen.getByLabelText(/What went wrong/), '  The reward never shipped.  ');
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    await waitFor(() => expect(openMock).toHaveBeenCalledWith('pledge-1', 'The reward never shipped.'));
    expect(await screen.findByText(COPY.opened)).toBeInTheDocument();
  });

  it('words a closed window rather than guessing at it beforehand', async () => {
    openMock.mockRejectedValue(new ApiError(409, { status: 409, code: 'DISPUTE_WINDOW_CLOSED' }));
    const user = userEvent.setup();
    render(<BackerDisputeForm pledgeId="pledge-1" copy={COPY} />);

    await user.click(screen.getByRole('button', { name: COPY.heading }));
    await user.type(screen.getByLabelText(/What went wrong/), 'Too late?');
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(await screen.findByText(COPY.windowClosed)).toBeInTheDocument();
  });
});
