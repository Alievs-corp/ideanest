import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PledgeEditor } from './PledgeEditor';
import { getPublicRewards, raisePledge, type PledgeResponse } from '../../lib/pledges/api';
import { leaveForPaymentPage } from '../../lib/pledges/payment';
import { ApiError } from '../../lib/api/problem';
import { checkoutCopyFrom, fillPlaceholders } from '../../lib/i18n/checkout-copy';
import { pledgeManagerCopyFrom } from '../../lib/i18n/pledges-copy';
import { formatMoney } from '../../lib/money';
import { translatorFor } from '../../test-copy';

vi.mock('../../lib/pledges/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/api')>()),
  getPublicRewards: vi.fn(),
  raisePledge: vi.fn(),
  editPledge: vi.fn(),
}));

vi.mock('../../lib/pledges/payment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/payment')>()),
  leaveForPaymentPage: vi.fn(),
}));

/* The words the page resolves, built from the catalogue with the same builders (#131). */
const CHECKOUT = checkoutCopyFrom(translatorFor('checkout'));
const EDITOR = pledgeManagerCopyFrom(translatorFor('account.pledges')).editor;

/**
 * #171: a paid pledge, raised while its campaign takes pledges, by paying the difference.
 *
 * The editor in `mode="raise"` is the form the pledge manager draws for a `COLLECTED` pledge the
 * service says is `raisable`. What is tested is the part that is money: the figure the backer is
 * shown is the figure sent as `expectedAmount`, only an increase is offered, the browser leaves for
 * the provider's page only when the service opened one, and a refusal leaves the backer on the page
 * with the catalogue's words and nothing charged.
 */
function paid(overrides: Partial<PledgeResponse> = {}): PledgeResponse {
  return {
    id: 'pledge-1',
    projectId: 'project-1',
    state: 'COLLECTED',
    rewardTierId: null,
    addons: [],
    amounts: {
      base: { amount: '50.00', currency: 'AZN' },
      addons: { amount: '0.00', currency: 'AZN' },
      bonus: { amount: '0.00', currency: 'AZN' },
      shipping: { amount: '0.00', currency: 'AZN' },
      tax: { amount: '0.00', currency: 'AZN' },
      total: { amount: '50.00', currency: 'AZN' },
    },
    shippingCountry: null,
    isAnonymous: false,
    reservationExpiresAt: null,
    confirmedAt: '2026-09-01T00:00:00Z',
    canceledAt: null,
    paymentMethodId: null,
    cardVerified: false,
    latePledge: false,
    supplements: [],
    raisable: true,
    latestRaise: null,
    ...overrides,
  };
}

const AZN = (amount: string) => formatMoney({ amount, currency: 'AZN' });

async function renderRaise(pledge: PledgeResponse = paid()) {
  vi.mocked(getPublicRewards).mockResolvedValue({ currency: 'AZN', rewards: [], addons: [] });
  render(<PledgeEditor copy={CHECKOUT} pledges={EDITOR} pledge={pledge} onSaved={vi.fn()} mode="raise" />);
  await screen.findByRole('heading', { name: EDITOR.raiseHeading });
}

async function giveInstead(amount: string) {
  const user = userEvent.setup();
  const field = screen.getByLabelText(CHECKOUT.contribution.legendNoReward, { exact: false });
  await user.clear(field);
  await user.type(field, amount);
  return user;
}

beforeEach(() => {
  vi.mocked(raisePledge).mockReset();
  vi.mocked(leaveForPaymentPage).mockReset();
});

afterEach(cleanup);

describe('raising a paid pledge', () => {
  it('is introduced with the catalogue’s own words, and offers no anonymity box', async () => {
    await renderRaise();

    expect(screen.getByText(EDITOR.raiseIntro)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // Nothing chosen yet, so nothing to pay.
    expect(screen.getByRole('button', { name: EDITOR.raiseHeading })).toBeDisabled();
    expect(screen.getByText(EDITOR.noChanges)).toBeInTheDocument();
  });

  it('shows the difference, and asks the provider for exactly that figure', async () => {
    vi.mocked(raisePledge).mockResolvedValue({
      pledgeId: 'pledge-1',
      raiseId: 'raise-1',
      amount: { amount: '25.00', currency: 'AZN' },
      total: { amount: '75.00', currency: 'AZN' },
      holdExpiresAt: '2026-09-29T12:15:00Z',
      providerTransactionId: 'provider-1',
      redirectUrl: 'https://pay.example/provider-1',
    });
    await renderRaise();

    const user = await giveInstead('75.00');

    expect(screen.getByText(fillPlaceholders(EDITOR.raiseDue, { amount: AZN('25.00') }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: fillPlaceholders(EDITOR.raisePay, { amount: AZN('25.00') }) }));

    expect(raisePledge).toHaveBeenCalledTimes(1);
    const [id, body, key] = vi.mocked(raisePledge).mock.calls[0] ?? [];
    expect(id).toBe('pledge-1');
    expect(body).toMatchObject({
      contribution: { amount: '75.00', currency: 'AZN' },
      expectedAmount: { amount: '25.00', currency: 'AZN' },
    });
    // The anonymity flag and the card are not part of a raise.
    expect(body && Object.hasOwn(body, 'isAnonymous')).toBe(false);
    expect(body?.successUrl).toMatch(/\/pledges\/pledge-1\?raise=returned$/u);
    expect(body?.errorUrl).toMatch(/\/pledges\/pledge-1\?raise=failed$/u);
    expect(typeof key).toBe('string');
    expect(leaveForPaymentPage).toHaveBeenCalledWith('https://pay.example/provider-1');
  });

  it('offers nothing to pay for a selection that costs no more than the pledge does now', async () => {
    await renderRaise();

    await giveInstead('40.00');

    expect(screen.getByText(EDITOR.raiseNotHigher)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EDITOR.raiseHeading })).toBeDisabled();
    expect(raisePledge).not.toHaveBeenCalled();
  });

  it('says why a raise was refused, charges nothing, and stays on the page', async () => {
    vi.mocked(raisePledge).mockRejectedValue(
      new ApiError(409, { code: 'RAISE_AMOUNT_CHANGED', status: 409, title: 'Refused' }),
    );
    await renderRaise();

    const user = await giveInstead('75.00');
    const pay = screen.getByRole('button', { name: fillPlaceholders(EDITOR.raisePay, { amount: AZN('25.00') }) });
    await user.click(pay);

    expect(await screen.findByText(CHECKOUT.failures.codes.RAISE_AMOUNT_CHANGED.title)).toBeInTheDocument();
    expect(screen.getByText(CHECKOUT.failures.codes.RAISE_AMOUNT_CHANGED.detail)).toBeInTheDocument();
    expect(leaveForPaymentPage).not.toHaveBeenCalled();
    expect(pay).toBeEnabled();
  });

  it('holds the button while an earlier raise is still waiting for its payment', async () => {
    const holdExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await renderRaise(
      paid({
        latestRaise: {
          id: 'raise-0',
          state: 'PENDING',
          amount: { amount: '10.00', currency: 'AZN' },
          total: { amount: '60.00', currency: 'AZN' },
          holdExpiresAt,
          createdAt: new Date().toISOString(),
          endedAt: null,
        },
      }),
    );

    const [before] = EDITOR.raisePending.split('{time}');
    expect(screen.getByText((text) => before !== undefined && text.startsWith(before.trim()))).toBeInTheDocument();

    await giveInstead('75.00');
    expect(
      screen.getByRole('button', { name: fillPlaceholders(EDITOR.raisePay, { amount: AZN('25.00') }) }),
    ).toBeDisabled();
  });
});

describe('a raise that is still waiting for its payment', () => {
  function pending(overrides: Partial<NonNullable<PledgeResponse['latestRaise']>> = {}): PledgeResponse {
    return paid({
      latestRaise: {
        id: 'raise-0',
        state: 'PENDING',
        amount: { amount: '10.00', currency: 'AZN' },
        total: { amount: '60.00', currency: 'AZN' },
        holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        endedAt: null,
        ...overrides,
      },
    });
  }

  const opening = (template: string) => (template.split('{time}')[0] ?? '').trim();

  it('offers the provider’s page again when the service has one to go back to', async () => {
    await renderRaise(pending({ resumeUrl: 'https://pay.example/provider-0' }));

    const resume = screen.getByRole('link', { name: EDITOR.raiseResume });
    expect(resume).toHaveAttribute('href', 'https://pay.example/provider-0');
    expect(screen.getByText((text) => text.startsWith(opening(EDITOR.raisePendingResumable)))).toBeInTheDocument();
  });

  it('promises no way back when there is none', async () => {
    await renderRaise(pending({ resumeUrl: null }));

    expect(screen.queryByRole('link', { name: EDITOR.raiseResume })).not.toBeInTheDocument();
    expect(screen.getByText((text) => text.startsWith(opening(EDITOR.raisePending)))).toBeInTheDocument();
  });

  it('gives the button back when the hold runs out, with nothing else drawing the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderRaise(pending({ holdExpiresAt: new Date(Date.now() + 60 * 1000).toISOString() }));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const field = screen.getByLabelText(CHECKOUT.contribution.legendNoReward, { exact: false });
      await user.clear(field);
      await user.type(field, '75.00');

      const pay = screen.getByRole('button', { name: fillPlaceholders(EDITOR.raisePay, { amount: AZN('25.00') }) });
      expect(pay).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(61 * 1000);
      });

      expect(pay).toBeEnabled();
      expect(screen.queryByText((text) => text.startsWith(opening(EDITOR.raisePending)))).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the raise form over a pledge that is read again', () => {
  it('keeps what the backer chose when a read brings back the same pledge', async () => {
    vi.mocked(getPublicRewards).mockResolvedValue({ currency: 'AZN', rewards: [], addons: [] });
    const { rerender } = render(
      <PledgeEditor copy={CHECKOUT} pledges={EDITOR} pledge={paid()} onSaved={vi.fn()} mode="raise" />,
    );
    await screen.findByRole('heading', { name: EDITOR.raiseHeading });
    await giveInstead('75.00');

    // The manager's polling: a new object every time, describing the same pledge.
    rerender(<PledgeEditor copy={CHECKOUT} pledges={EDITOR} pledge={paid()} onSaved={vi.fn()} mode="raise" />);

    expect(screen.getByLabelText(CHECKOUT.contribution.legendNoReward, { exact: false })).toHaveValue('75.00');
  });

  it('starts again from the pledge when a read brings back a changed one', async () => {
    vi.mocked(getPublicRewards).mockResolvedValue({ currency: 'AZN', rewards: [], addons: [] });
    const { rerender } = render(
      <PledgeEditor copy={CHECKOUT} pledges={EDITOR} pledge={paid()} onSaved={vi.fn()} mode="raise" />,
    );
    await screen.findByRole('heading', { name: EDITOR.raiseHeading });
    await giveInstead('75.00');

    const raised = paid({
      amounts: {
        ...paid().amounts,
        base: { amount: '75.00', currency: 'AZN' },
        total: { amount: '75.00', currency: 'AZN' },
      },
    });
    rerender(<PledgeEditor copy={CHECKOUT} pledges={EDITOR} pledge={raised} onSaved={vi.fn()} mode="raise" />);

    expect(screen.getByLabelText(CHECKOUT.contribution.legendNoReward, { exact: false })).toHaveValue('75.00');
    expect(screen.getByText(EDITOR.noChanges)).toBeInTheDocument();
  });

  it('offers nothing to pay while nothing has changed, even where the figures have drifted', async () => {
    // A stored total below what the selection prices at: the preview would call the gap "due".
    await renderRaise(
      paid({ amounts: { ...paid().amounts, total: { amount: '45.00', currency: 'AZN' } } }),
    );

    expect(screen.queryByText(fillPlaceholders(EDITOR.raiseDue, { amount: AZN('5.00') }))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: EDITOR.raiseHeading })).toBeDisabled();
    expect(screen.getByText(EDITOR.noChanges)).toBeInTheDocument();
  });

  it('hands the form back when the browser restores the page from its back-forward cache', async () => {
    vi.mocked(raisePledge).mockResolvedValue({
      pledgeId: 'pledge-1',
      raiseId: 'raise-1',
      amount: { amount: '25.00', currency: 'AZN' },
      total: { amount: '75.00', currency: 'AZN' },
      holdExpiresAt: '2026-09-29T12:15:00Z',
      providerTransactionId: 'provider-1',
      redirectUrl: 'https://pay.example/provider-1',
    });
    await renderRaise();
    const user = await giveInstead('75.00');
    await user.click(screen.getByRole('button', { name: fillPlaceholders(EDITOR.raisePay, { amount: AZN('25.00') }) }));

    const leaving = await screen.findByRole('button', { name: EDITOR.raiseOpening });
    expect(leaving).toBeDisabled();

    // An ordinary load of the page is not a restore, and changes nothing.
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    });
    expect(screen.getByRole('button', { name: EDITOR.raiseOpening })).toBeDisabled();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(
      screen.getByRole('button', { name: fillPlaceholders(EDITOR.raisePay, { amount: AZN('25.00') }) }),
    ).toBeEnabled();
  });
});
