import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PAYMENT_CHECKS, PAYMENT_CHECK_INTERVAL_MS } from '@ideanest/checkout/pledge';
import { ApiError } from '../../lib/api/problem';
import type { HeldSubscription, Plan } from '../../lib/plans/api';
import {
  cancelSubscription,
  formatPrice,
  payForPlan,
  readMySubscription,
  subscribeToPlan,
} from '../../lib/plans/api';
import { leaveForPaymentPage } from '../../lib/pledges/payment';
import { PlanChooser } from './PlanChooser';
import { pricingCopyFrom } from '../../lib/i18n/plans-copy';
import { dateTimeFormat } from '../../lib/i18n/formats';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';

/*
 * The copy is built from `messages/en.json` with the builder the route calls, rather than
 * typed out here. `src/test-copy.ts` explains why: a suite that retyped the sentences would
 * still be green with the catalogue empty, which is what `catalogue.test.ts` exists to catch.
 */
const COPY = pricingCopyFrom(translatorFor('pricing'));

vi.mock('../../lib/plans/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/plans/api')>();
  return {
    ...actual,
    readMySubscription: vi.fn(),
    subscribeToPlan: vi.fn(),
    cancelSubscription: vi.fn(),
    payForPlan: vi.fn(),
  };
});

/* jsdom implements no navigation: leaving for the provider is observed rather than attempted. */
vi.mock('../../lib/pledges/payment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/payment')>()),
  leaveForPaymentPage: vi.fn(),
}));

/*
 * The chooser navigates now: a creator sent here by a refused submission is taken back to
 * their campaign the moment the plan they chose entitles them.
 *
 * Spread first so the real module's other exports survive -- `i18n/navigation.tsx` reads
 * `redirect` and `permanentRedirect` at import time, and a factory that replaced the module
 * wholesale left those undefined.
 */
const push = vi.fn();

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

const readMock = vi.mocked(readMySubscription);
const subscribeMock = vi.mocked(subscribeToPlan);
const cancelMock = vi.mocked(cancelSubscription);
const payMock = vi.mocked(payForPlan);
const leaveMock = vi.mocked(leaveForPaymentPage);

const STARTER: Plan = {
  id: '11111111-0000-4000-8000-000000000001',
  code: 'STARTER',
  name: 'Starter',
  description: 'For a first project.',
  price: '19.00',
  currency: 'AZN',
  billingPeriod: 'MONTHLY',
  maxActiveCampaigns: 1,
  goalCeiling: '10000.00',
  listed: true,
  sortOrder: 10,
  updatedAt: '2026-08-01T09:00:00Z',
};

const PRO: Plan = {
  ...STARTER,
  id: '11111111-0000-4000-8000-000000000003',
  code: 'PRO',
  name: 'Pro',
  description: null,
  price: '149.00',
  maxActiveCampaigns: null,
  goalCeiling: null,
  sortOrder: 30,
};

const PLANS: readonly Plan[] = [STARTER, PRO];

function held(overrides: Partial<HeldSubscription> = {}): HeldSubscription {
  return {
    id: '22222222-0000-4000-8000-000000000001',
    state: 'ACTIVE',
    entitled: true,
    plan: STARTER,
    price: '19.00',
    currency: 'AZN',
    billingPeriod: 'MONTHLY',
    startedAt: '2026-08-01T09:00:00Z',
    currentPeriodEnd: '2026-09-01T09:00:00Z',
    cancelAtPeriodEnd: false,
    createdAt: '2026-08-01T09:00:00Z',
    ...overrides,
  };
}

function draw(props: Partial<React.ComponentProps<typeof PlanChooser>> = {}) {
  return render(<PlanChooser plans={PLANS} copy={COPY} locale="en" {...props} />);
}

beforeEach(() => {
  // The router is shared by every test in this file; a redirect one of them provoked must not
  // be counted against the next.
  push.mockClear();
  readMock.mockReset();
  payMock.mockReset();
  leaveMock.mockReset();
  window.history.replaceState({}, '', '/en/pricing');
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

/** The plan's own price, as the page prints it. */
const PRICE = formatPrice('19.00', 'AZN', 'en');

/** A date as the panel prints it, through the same formatter. */
function day(iso: string): string {
  return dateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }, 'plan-renewal').format(
    new Date(iso),
  );
}

const PAY_BY_CARD = fillPlaceholders(COPY.payment.payByCard, { price: PRICE });
const RENEW = fillPlaceholders(COPY.payment.renew, { price: PRICE });

const PENDING = held({
  state: 'PENDING_PAYMENT',
  entitled: false,
  startedAt: null,
  currentPeriodEnd: null,
  paymentDue: 'FIRST_PERIOD',
  renewalOpensAt: null,
});
const RENEWING = held({ paymentDue: 'RENEWAL', renewalOpensAt: '2026-08-25T09:00:00Z' });
const ACTIVE = held({ paymentDue: null, renewalOpensAt: '2026-08-25T09:00:00Z' });
const PAID_AFTER = held({ paymentDue: null, currentPeriodEnd: '2026-10-01T09:00:00Z' });

describe('the plan chooser', () => {
  it('renders the prices before it knows anything about the reader', () => {
    // Never resolves: the catalogue is a prop and must not wait on a fetch.
    readMock.mockReturnValue(new Promise(() => {}));

    draw();

    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('says a limitless plan has no limit rather than showing a number', async () => {
    readMock.mockResolvedValue({ subscription: null });

    draw();

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    expect(screen.getByText(COPY.limits.campaignsUnlimited)).toBeInTheDocument();
    expect(screen.getByText(COPY.limits.goalUnlimited)).toBeInTheDocument();
  });

  it('offers the prices to somebody with no session rather than refusing the page', async () => {
    // A 401 here is a visitor deciding whether to bring their campaign here, which is what
    // this page is for -- not a failure.
    readMock.mockRejectedValue(new ApiError(401, null, 'not signed in'));

    draw();

    expect(await screen.findByText(COPY.signedOut)).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.queryByText(COPY.errors.generic)).not.toBeInTheDocument();
  });

  it('explains why the reader is here when a refused submission sent them', async () => {
    readMock.mockResolvedValue({ subscription: null });

    draw({ fromProjectId: 'abc-123' });

    expect(await screen.findByText(COPY.fromSubmit.title)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.fromSubmit.back })).toHaveAttribute(
      'href',
      '/en/projects/abc-123/edit/review',
    );
  });

  it('takes the creator back to their campaign the moment the plan entitles them', async () => {
    readMock.mockResolvedValue({ subscription: null });
    subscribeMock.mockResolvedValue({ subscription: held() });

    draw({ fromProjectId: 'abc-123' });

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /Choose this plan: Starter/ }));

    // The page has finished its business with them: they came to be allowed to submit, and
    // they now are. Leaving them on a price list to find their own way back is the failure
    // `?from=submit&project=` exists to prevent.
    // `stringContaining` because `useRouter` prefixes the reader's language, the same way the
    // review panel's own redirect does.
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.stringContaining('/projects/abc-123/edit/review'),
      ),
    );
  });

  it('leaves a creator on the price list when the plan is chosen and not yet paid for', async () => {
    readMock.mockResolvedValue({ subscription: null });
    subscribeMock.mockResolvedValue({
      subscription: held({ state: 'PENDING_PAYMENT', entitled: false, currentPeriodEnd: null }),
    });

    draw({ fromProjectId: 'abc-123' });

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /Choose this plan: Starter/ }));

    // Sending them back would send them to a campaign that refuses them again, which is a
    // worse answer than the page explaining what is still needed.
    expect(await screen.findByText(COPY.held.pendingBody)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('offers the way back once the plan is active, rather than repeating why they came', async () => {
    readMock.mockResolvedValue({ subscription: held() });

    draw({ fromProjectId: 'abc-123' });

    expect(await screen.findByText(COPY.fromSubmit.ready)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.fromSubmit.resume })).toHaveAttribute(
      'href',
      '/en/projects/abc-123/edit/review',
    );
    expect(screen.queryByText(COPY.fromSubmit.title)).not.toBeInTheDocument();
  });

  it('says nothing about a campaign when the reader arrived on their own', async () => {
    readMock.mockResolvedValue({ subscription: null });

    draw();

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    // Somebody who found this page from the navigation is not owed an explanation of why
    // they are looking at it.
    expect(screen.queryByText(COPY.fromSubmit.title)).not.toBeInTheDocument();
  });

  it('does not congratulate somebody on a payment the platform has not seen', async () => {
    readMock.mockResolvedValue({ subscription: null });
    subscribeMock.mockResolvedValue({
      subscription: held({ state: 'PENDING_PAYMENT', entitled: false, currentPeriodEnd: null }),
    });

    draw();

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /Choose this plan: Starter/ }));

    expect(await screen.findByText(COPY.held.pendingBody)).toBeInTheDocument();
    expect(subscribeMock).toHaveBeenCalledWith(STARTER.id);
  });

  it('says when a plan runs to, and offers to stop it renewing', async () => {
    readMock.mockResolvedValue({ subscription: held() });

    draw();

    expect(await screen.findByRole('button', { name: COPY.held.cancel })).toBeInTheDocument();
  });

  it('does not offer to cancel a subscription that is already ending', async () => {
    readMock.mockResolvedValue({ subscription: held({ cancelAtPeriodEnd: true }) });

    draw();

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: COPY.held.cancel })).not.toBeInTheDocument();
  });

  it('keeps the entitlement on screen after cancelling, because the period was paid for', async () => {
    readMock.mockResolvedValue({ subscription: held() });
    cancelMock.mockResolvedValue({ subscription: held({ cancelAtPeriodEnd: true }) });

    draw();

    await userEvent.click(await screen.findByRole('button', { name: COPY.held.cancel }));

    await waitFor(() => expect(cancelMock).toHaveBeenCalled());
    // Still entitled: taking the month back on the click would be charging for something and
    // then withdrawing it.
    expect(screen.queryByText(COPY.held.pendingBody)).not.toBeInTheDocument();
  });

  it('names the refusal it was given rather than one message for everything', async () => {
    readMock.mockResolvedValue({ subscription: null });
    subscribeMock.mockRejectedValue(
      new ApiError(409, { code: 'PLAN_NOT_ON_SALE' }, 'no longer offered'),
    );

    draw();

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /Choose this plan: Starter/ }));

    expect(await screen.findByText(COPY.errors.notOnSale)).toBeInTheDocument();
  });
});

describe('paying for a plan by card (#451)', () => {
  it('offers to pay the first period by card, beside the bank transfer that stays the alternative', async () => {
    readMock.mockResolvedValue({ subscription: PENDING });

    draw();

    expect(await screen.findByRole('button', { name: PAY_BY_CARD })).toBeInTheDocument();
    expect(screen.getByText(COPY.payment.cardBody)).toBeInTheDocument();
    expect(screen.getByText(COPY.held.pendingBody)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RENEW })).not.toBeInTheDocument();
  });

  it('offers no card payment for a pending plan the service says has nothing due', async () => {
    readMock.mockResolvedValue({ subscription: { ...PENDING, paymentDue: null } });

    draw();

    expect(await screen.findByText(COPY.held.pendingBody)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: PAY_BY_CARD })).not.toBeInTheDocument();
  });

  it('says when a plan inside its renewal window ends, and offers to renew it at its own price', async () => {
    readMock.mockResolvedValue({ subscription: RENEWING });

    draw();

    expect(await screen.findByRole('button', { name: RENEW })).toBeInTheDocument();
    expect(
      screen.getAllByText(
        fillPlaceholders(COPY.payment.renewalTitle, { plan: 'Starter', date: day('2026-09-01T09:00:00Z') }),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(COPY.payment.renewalBody)).toBeInTheDocument();
    expect(screen.queryByText(COPY.payment.renewalCancelled)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: PAY_BY_CARD })).not.toBeInTheDocument();
  });

  it('tells a creator who cancelled that renewing resumes the plan', async () => {
    readMock.mockResolvedValue({ subscription: { ...RENEWING, cancelAtPeriodEnd: true } });

    draw();

    expect(await screen.findByRole('button', { name: RENEW })).toBeInTheDocument();
    expect(screen.getByText(COPY.payment.renewalCancelled)).toBeInTheDocument();
  });

  it('says when renewing opens for a plan not yet in its window, and offers no button', async () => {
    readMock.mockResolvedValue({ subscription: ACTIVE });

    draw();

    expect(
      await screen.findByText(fillPlaceholders(COPY.payment.renewsFrom, { date: day('2026-08-25T09:00:00Z') })),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RENEW })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: PAY_BY_CARD })).not.toBeInTheDocument();
  });

  it('offers no payment for a lapsed plan, which is bought again rather than renewed', async () => {
    readMock.mockResolvedValue({
      subscription: held({ state: 'EXPIRED', entitled: false, paymentDue: null, renewalOpensAt: null }),
    });

    draw();

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /Choose this plan: Starter/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RENEW })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: PAY_BY_CARD })).not.toBeInTheDocument();
    expect(screen.queryByText(/renew from/i)).not.toBeInTheDocument();
  });

  it('opens the provider page with an idempotency key and sends the browser there', async () => {
    readMock.mockResolvedValue({ subscription: PENDING });
    let answer: (page: { providerTransactionId: string; redirectUrl: string }) => void = () => {};
    payMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    draw();
    await userEvent.click(await screen.findByRole('button', { name: PAY_BY_CARD }));

    // In flight: the control says so and cannot be pressed into a second request.
    const opening = screen.getByRole('button', { name: COPY.payment.opening });
    expect(opening).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(opening);
    expect(payMock).toHaveBeenCalledTimes(1);

    const [body, key] = payMock.mock.calls[0] ?? [];
    expect(body).toEqual({
      language: 'en',
      successUrl: `${window.location.origin}/en/pricing?payment=returned`,
      errorUrl: `${window.location.origin}/en/pricing?payment=failed`,
    });
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

    await act(async () => answer({ providerTransactionId: 'order-1', redirectUrl: 'https://pay.test/order-1' }));
    expect(leaveMock).toHaveBeenCalledWith('https://pay.test/order-1');
  });

  it('keeps the way back to a campaign through the trip to the provider', async () => {
    readMock.mockResolvedValue({ subscription: PENDING });
    payMock.mockResolvedValue({ providerTransactionId: 'order-1', redirectUrl: 'https://pay.test/order-1' });

    draw({ fromProjectId: 'abc-123' });
    await userEvent.click(await screen.findByRole('button', { name: PAY_BY_CARD }));

    await waitFor(() => expect(payMock).toHaveBeenCalled());
    expect(payMock.mock.calls[0]?.[0].successUrl).toBe(
      `${window.location.origin}/en/pricing?from=submit&project=abc-123&payment=returned`,
    );
  });

  it('mints a new idempotency key for each press', async () => {
    readMock.mockResolvedValue({ subscription: PENDING });
    payMock.mockRejectedValue(new ApiError(503, { code: 'PAYMENT_UNAVAILABLE' }, 'unavailable'));

    draw();
    await userEvent.click(await screen.findByRole('button', { name: PAY_BY_CARD }));
    await userEvent.click(await screen.findByRole('button', { name: PAY_BY_CARD }));

    await waitFor(() => expect(payMock).toHaveBeenCalledTimes(2));
    expect(payMock.mock.calls[0]?.[1]).not.toBe(payMock.mock.calls[1]?.[1]);
  });

  it.each([
    ['FREE_PLAN', 'freePlan'],
    ['RENEWAL_NOT_OPEN', 'renewalNotOpen'],
    ['LAPSED', 'lapsed'],
    [undefined, 'notDue'],
  ] as const)('names a refusal whose reason is %s, and reads the plan again', async (reason, key) => {
    readMock.mockResolvedValue({ subscription: RENEWING });
    payMock.mockRejectedValue(
      new ApiError(409, { code: 'SUBSCRIPTION_PAYMENT_NOT_DUE', ...(reason ? { reason } : {}) }, 'not due'),
    );

    draw();
    await userEvent.click(await screen.findByRole('button', { name: RENEW }));

    expect(await screen.findByText(COPY.errors[key])).toBeInTheDocument();
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2));
    expect(leaveMock).not.toHaveBeenCalled();
  });

  it('says card payments are unavailable, that nothing was charged, and goes nowhere', async () => {
    readMock.mockResolvedValue({ subscription: PENDING });
    payMock.mockRejectedValue(new ApiError(503, { code: 'PAYMENT_UNAVAILABLE' }, 'unavailable'));

    draw();
    await userEvent.click(await screen.findByRole('button', { name: PAY_BY_CARD }));

    expect(await screen.findByText(COPY.errors.paymentUnavailable)).toBeInTheDocument();
    expect(leaveMock).not.toHaveBeenCalled();
    // The control is offered again: nothing was charged and a retry is the reader's to make.
    expect(screen.getByRole('button', { name: PAY_BY_CARD })).toHaveAttribute('aria-disabled', 'false');
  });

  it('has no accessibility violations with a payment and a renewal on offer', async () => {
    readMock.mockResolvedValue({ subscription: PENDING });
    const { container, unmount } = draw();
    await screen.findByRole('button', { name: PAY_BY_CARD });
    await expectNoViolations(container);
    unmount();

    readMock.mockResolvedValue({ subscription: { ...RENEWING, cancelAtPeriodEnd: true } });
    const renewal = draw();
    await screen.findByRole('button', { name: RENEW });
    await expectNoViolations(renewal.container);
  });
});

describe('coming back from the provider (#451)', () => {
  const RETURNED = COPY.payment.returned;

  /** Lets the reads the page made, and the renders they cause, finish. */
  async function settle(ms = 0): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the confirmation, offers no second payment, then says the plan is paid', async () => {
    window.history.replaceState({}, '', '/en/pricing?payment=returned');
    readMock.mockResolvedValueOnce({ subscription: PENDING }).mockResolvedValue({
      subscription: held({ currentPeriodEnd: '2026-09-01T09:00:00Z', paymentDue: null }),
    });

    draw();
    await settle();

    expect(screen.getByText(RETURNED.waitingTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: PAY_BY_CARD })).not.toBeInTheDocument();

    await settle(PAYMENT_CHECK_INTERVAL_MS);

    expect(screen.getByText(RETURNED.paidTitle)).toBeInTheDocument();
    expect(
      screen.getByText(fillPlaceholders(RETURNED.paidBody, { plan: 'Starter', date: day('2026-09-01T09:00:00Z') })),
    ).toBeInTheDocument();
    expect(screen.queryByText(RETURNED.waitingTitle)).not.toBeInTheDocument();
  });

  it('says a renewal went through once the period has moved out of the window', async () => {
    window.history.replaceState({}, '', '/en/pricing?payment=returned');
    readMock.mockResolvedValueOnce({ subscription: RENEWING }).mockResolvedValue({ subscription: PAID_AFTER });

    draw();
    await settle();
    expect(screen.getByText(RETURNED.waitingTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RENEW })).not.toBeInTheDocument();

    await settle(PAYMENT_CHECK_INTERVAL_MS);
    expect(screen.getByText(RETURNED.paidTitle)).toBeInTheDocument();
  });

  it('stops asking after a minute and says it has not heard back, never that it failed', async () => {
    window.history.replaceState({}, '', '/en/pricing?payment=returned');
    readMock.mockResolvedValue({ subscription: PENDING });

    draw();
    await settle();
    for (let check = 0; check < PAYMENT_CHECKS; check += 1) await settle(PAYMENT_CHECK_INTERVAL_MS);

    expect(screen.getByText(RETURNED.unconfirmedTitle)).toBeInTheDocument();
    expect(screen.queryByText(RETURNED.failedTitle)).not.toBeInTheDocument();
    // The first read and one per check, then no more.
    expect(readMock).toHaveBeenCalledTimes(PAYMENT_CHECKS + 1);
    await settle(PAYMENT_CHECK_INTERVAL_MS * 3);
    expect(readMock).toHaveBeenCalledTimes(PAYMENT_CHECKS + 1);
  });

  it('says the payment did not go through when the provider sent them back through the error door', async () => {
    window.history.replaceState({}, '', '/en/pricing?payment=failed');
    readMock.mockResolvedValue({ subscription: PENDING });

    draw();
    await settle();

    expect(screen.getByText(RETURNED.failedTitle)).toBeInTheDocument();
    // And they can try again.
    expect(screen.getByRole('button', { name: PAY_BY_CARD })).toBeInTheDocument();
    await settle(PAYMENT_CHECK_INTERVAL_MS * 2);
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a payment when the reader did not come back from one', async () => {
    readMock.mockResolvedValue({ subscription: PENDING });

    draw();
    await settle();

    expect(screen.queryByText(RETURNED.waitingTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(RETURNED.failedTitle)).not.toBeInTheDocument();
  });
});
