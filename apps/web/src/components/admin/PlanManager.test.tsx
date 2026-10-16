import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { ConsoleSubscription, Plan } from '../../lib/admin/plans';
import {
  activateSubscription,
  addPlan,
  cancelSubscriptionAsStaff,
  changePlan,
  readPlanCatalogue,
  readSubscriptions,
} from '../../lib/admin/plans';
import { lookUpNames } from '../../lib/admin/directory';
import { bankDay } from '../../lib/admin/payouts';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { PlanManager } from './PlanManager';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { planManagerCopyFrom } from '../../lib/i18n/admin/money-copy';

/*
 * The copy is built from `messages/en.json` with the same builders the route calls, rather
 * than typed out here — `src/test-copy.ts` has the argument.
 */
const COPY = planManagerCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/plans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/plans')>()),
  readPlanCatalogue: vi.fn(),
  readSubscriptions: vi.fn(),
  addPlan: vi.fn(),
  changePlan: vi.fn(),
  activateSubscription: vi.fn(),
  cancelSubscriptionAsStaff: vi.fn(),
}));

const catalogueMock = vi.mocked(readPlanCatalogue);
const subscriptionsMock = vi.mocked(readSubscriptions);
const addPlanMock = vi.mocked(addPlan);
const changePlanMock = vi.mocked(changePlan);
const activateMock = vi.mocked(activateSubscription);
const endMock = vi.mocked(cancelSubscriptionAsStaff);
const namesMock = vi.mocked(lookUpNames);

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  namesMock.mockResolvedValue({
    accounts: [{ id: '33333333-0000-4000-8000-000000000001', name: 'Nərmin Həsənova', slug: 'nermin' }],
    projects: [],
  });
});

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

const RETIRED: Plan = { ...STARTER, id: '11111111-0000-4000-8000-000000000009', code: 'OLD', name: 'Old', listed: false };

const WAITING: ConsoleSubscription = {
  id: '22222222-0000-4000-8000-000000000001',
  accountId: '33333333-0000-4000-8000-000000000001',
  state: 'PENDING_PAYMENT',
  entitled: false,
  planCode: 'STARTER',
  planName: 'Starter',
  price: '19.00',
  currency: 'AZN',
  billingPeriod: 'MONTHLY',
  startedAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  activatedBy: null,
  note: null,
  createdAt: '2026-08-20T09:00:00Z',
};

function ready(plans: readonly Plan[] = [STARTER], subscriptions: readonly ConsoleSubscription[] = []) {
  catalogueMock.mockResolvedValue({ plans });
  subscriptionsMock.mockResolvedValue({ subscriptions });
}

describe('the plan manager', () => {
  it('says out loud that an edit reaches everybody on the plan', async () => {
    ready();

    render(<PlanManager copy={COPY} />);

    // Somebody arriving from the fee editor next door arrives expecting nothing to be
    // editable at all. Without this notice they lower a limit believing it applies only to
    // new customers.
    expect(await screen.findByText(COPY.noticeBody)).toBeInTheDocument();
  });

  it('lists retired plans too, because their subscribers are still on them', async () => {
    ready([STARTER, RETIRED]);

    render(<PlanManager copy={COPY} />);

    expect((await screen.findAllByText(/Old/))[0]).toBeInTheDocument();
    expect(screen.getByText(COPY.retired)).toBeInTheDocument();
  });

  it('offers no way to delete a plan, only to take it off sale', async () => {
    ready();

    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Take off sale/ })).toBeInTheDocument();
  });

  it('takes a plan off sale rather than removing it', async () => {
    ready();
    changePlanMock.mockResolvedValue({ ...STARTER, listed: false });

    render(<PlanManager copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: /Take off sale/ }));

    // Asked first: taking a plan off sale stops every new creator buying it.
    expect(screen.getByText(fillPlaceholders(COPY.confirmRetire, { plan: STARTER.name }))).toBeInTheDocument();
    expect(changePlanMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmRetireAction }));

    await waitFor(() =>
      expect(changePlanMock).toHaveBeenCalledWith({ planId: STARTER.id, listed: false }),
    );
  });

  it('sends an empty limit as no limit rather than as zero', async () => {
    ready();
    addPlanMock.mockResolvedValue(STARTER);

    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    await userEvent.type(screen.getByLabelText(COPY.codeLabel), 'growth');
    await userEvent.type(screen.getByLabelText(COPY.nameLabel), 'Growth');
    await userEvent.clear(screen.getByLabelText(COPY.maxActiveLabel));
    await userEvent.click(screen.getByRole('button', { name: COPY.addPlan }));

    await waitFor(() => expect(addPlanMock).toHaveBeenCalled());
    const sent = addPlanMock.mock.calls[0]?.[0];
    expect(sent?.maxActiveCampaigns).toBeNull();
    expect(sent?.goalCeiling).toBeNull();
    // Upper-cased on the way out, so "growth" and "GROWTH" are not two plans.
    expect(sent?.code).toBe('GROWTH');
  });

  it('records a payment against a subscription that is waiting for one', async () => {
    ready([STARTER], [WAITING]);
    activateMock.mockResolvedValue({ ...WAITING, state: 'ACTIVE', entitled: true });

    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    await userEvent.type(screen.getByLabelText(COPY.referenceLabel), 'transfer 44');
    await userEvent.click(screen.getByRole('button', { name: COPY.recordPayment }));
    expect(activateMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmRecordAction }));

    // The reference goes where the service keeps it, and how it was paid is said rather than assumed.
    await waitFor(() =>
      expect(activateMock).toHaveBeenCalledWith(WAITING.id, { method: 'BANK_TRANSFER', reference: 'transfer 44' }),
    );
  });

  it('offers no payment control against a subscription that is already active', async () => {
    ready([STARTER], [{ ...WAITING, state: 'ACTIVE', entitled: true, currentPeriodEnd: '2026-09-20T09:00:00Z' }]);

    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    expect(screen.queryByRole('button', { name: COPY.recordPayment })).not.toBeInTheDocument();
  });

  it('refuses honestly when the reader lacks the capability', async () => {
    catalogueMock.mockRejectedValue(new ApiError(403, { code: 'INSUFFICIENT_STAFF_CAPABILITY' }));
    subscriptionsMock.mockRejectedValue(new ApiError(403, { code: 'INSUFFICIENT_STAFF_CAPABILITY' }));

    render(<PlanManager copy={COPY} />);

    // Named rather than hidden: a member of staff who cannot see the screen has no way to
    // find out that it exists — `lib/admin/navigation.ts` has the argument.
    expect(await screen.findByText(COPY.refusals.forbiddenTitle)).toBeInTheDocument();
  });
});

describe('the money pages audit on the plan manager', () => {
  it('prints prices and ceilings as money', async () => {
    ready();

    render(<PlanManager copy={COPY} />);

    expect(
      await screen.findByText(
        fillPlaceholders(COPY.planSummary, {
          price: '19.00 AZN',
          period: COPY.period.MONTHLY,
          campaigns: '1',
          ceiling: '10,000.00 AZN',
        }),
      ),
    ).toBeInTheDocument();
  });

  it.each(['iki', '1.5', '0'])('refuses %s as a campaign limit instead of sending it as unlimited', async (typed) => {
    ready();
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    await userEvent.type(screen.getByLabelText(COPY.codeLabel), 'growth');
    await userEvent.type(screen.getByLabelText(COPY.nameLabel), 'Growth');
    await userEvent.clear(screen.getByLabelText(new RegExp(`^${COPY.maxActiveLabel}`)));
    await userEvent.type(screen.getByLabelText(new RegExp(`^${COPY.maxActiveLabel}`)), typed);

    expect(screen.getByText(COPY.maxActiveInvalid)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.addPlan })).toBeDisabled();
    expect(addPlanMock).not.toHaveBeenCalled();
  });

  it('reads a decimal comma in a price', async () => {
    ready();
    addPlanMock.mockResolvedValue(STARTER);
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    await userEvent.type(screen.getByLabelText(COPY.codeLabel), 'growth');
    await userEvent.type(screen.getByLabelText(COPY.nameLabel), 'Growth');
    await userEvent.clear(screen.getByLabelText(new RegExp(`^${COPY.priceLabel}`)));
    await userEvent.type(screen.getByLabelText(new RegExp(`^${COPY.priceLabel}`)), '24,50');
    await userEvent.click(screen.getByRole('button', { name: COPY.addPlan }));

    await waitFor(() => expect(addPlanMock).toHaveBeenCalled());
    expect(addPlanMock.mock.calls[0]?.[0].price).toBe('24.50');
  });

  it('says a refused plan in the reader language beside the form, never the service English', async () => {
    ready();
    addPlanMock.mockRejectedValueOnce(new ApiError(409, { status: 409, code: 'PLAN_CODE_TAKEN', detail: 'Code taken' }));
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    await userEvent.type(screen.getByLabelText(COPY.codeLabel), 'starter');
    await userEvent.type(screen.getByLabelText(COPY.nameLabel), 'Starter again');
    await userEvent.click(screen.getByRole('button', { name: COPY.addPlan }));

    const section = screen.getByRole('region', { name: COPY.addHeading });
    expect(await within(section).findByText(COPY.errors['PLAN_CODE_TAKEN'] ?? '')).toBeInTheDocument();
    expect(screen.queryByText('Code taken')).not.toBeInTheDocument();
  });

  it('asks before repricing, naming the old price and the new one', async () => {
    ready();
    changePlanMock.mockResolvedValue({ ...STARTER, price: '24.00' });
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    await userEvent.clear(screen.getByLabelText(new RegExp(`^${COPY.repriceLabel}`)));
    await userEvent.type(screen.getByLabelText(new RegExp(`^${COPY.repriceLabel}`)), '24,00');
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${COPY.reprice}`) }));

    expect(
      screen.getByText(fillPlaceholders(COPY.confirmReprice, { plan: STARTER.name, old: '19.00 AZN', new: '24.00 AZN' })),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmRepriceAction }));

    await waitFor(() => expect(changePlanMock).toHaveBeenCalledWith({ planId: STARTER.id, price: '24.00' }));
  });

  it('records how and when a payment arrived, and refuses a day after today', async () => {
    ready([STARTER], [WAITING]);
    activateMock.mockResolvedValue({ ...WAITING, state: 'ACTIVE', entitled: true });
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    const day = screen.getByLabelText(new RegExp(`^${COPY.receivedLabel}`));
    await userEvent.clear(day);
    await userEvent.type(day, '2999-01-01');
    expect(screen.getByText(COPY.receivedInvalid)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.recordPayment })).toBeDisabled();

    await userEvent.clear(day);
    await userEvent.type(day, '2026-10-01');
    await userEvent.selectOptions(screen.getByLabelText(new RegExp(`^${COPY.methodLabel}`)), 'CASH');
    await userEvent.click(screen.getByRole('button', { name: COPY.recordPayment }));
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmRecordAction }));

    await waitFor(() =>
      expect(activateMock).toHaveBeenCalledWith(WAITING.id, {
        method: 'CASH',
        receivedAt: new Date('2026-10-01T12:00:00+04:00').toISOString(),
      }),
    );
    expect(
      await screen.findByText(fillPlaceholders(COPY.activatedNotice, { account: 'Nərmin Həsənova' })),
    ).toBeInTheDocument();
  });

  it('records today as now', async () => {
    ready([STARTER], [WAITING]);
    activateMock.mockResolvedValue({ ...WAITING, state: 'ACTIVE', entitled: true });
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    expect(screen.getByLabelText(new RegExp(`^${COPY.receivedLabel}`))).toHaveValue(bankDay());
    await userEvent.click(screen.getByRole('button', { name: COPY.recordPayment }));
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmRecordAction }));

    await waitFor(() => expect(activateMock).toHaveBeenCalledWith(WAITING.id, { method: 'BANK_TRANSFER' }));
  });

  it('offers no ending on a subscription that has expired', async () => {
    ready([STARTER], [{ ...WAITING, state: 'EXPIRED', currentPeriodEnd: '2026-08-01T09:00:00Z' }]);
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    expect(screen.queryByRole('button', { name: COPY.endSubscription })).not.toBeInTheDocument();
  });

  it('ends an active subscription only after asking, with the reason', async () => {
    const active = { ...WAITING, state: 'ACTIVE' as const, entitled: true, currentPeriodEnd: '2026-11-20T09:00:00Z' };
    ready([STARTER], [active]);
    endMock.mockResolvedValue({ ...active, state: 'CANCELED', entitled: false });
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    await userEvent.type(screen.getByLabelText(new RegExp(`^${COPY.endReasonLabel}`)), 'Payment reversed');
    await userEvent.click(screen.getByRole('button', { name: COPY.endSubscription }));
    expect(endMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmEndAction }));

    await waitFor(() => expect(endMock).toHaveBeenCalledWith(active.id, 'Payment reversed'));
  });

  it('reads the list again when the subscription has already ended elsewhere, and says so in words', async () => {
    const active = { ...WAITING, state: 'ACTIVE' as const, entitled: true };
    ready([STARTER], [active]);
    endMock.mockRejectedValue(new ApiError(409, { status: 409, code: 'SUBSCRIPTION_NOT_OPEN' }));
    render(<PlanManager copy={COPY} />);
    await screen.findAllByText(/Starter/);

    await userEvent.type(screen.getByLabelText(new RegExp(`^${COPY.endReasonLabel}`)), 'Tidy');
    await userEvent.click(screen.getByRole('button', { name: COPY.endSubscription }));
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmEndAction }));

    expect(await screen.findByText(COPY.errors['SUBSCRIPTION_NOT_OPEN'] ?? '')).toBeInTheDocument();
    await waitFor(() => expect(subscriptionsMock).toHaveBeenCalledTimes(2));
  });

  it('offers a retry when the subscription list fails', async () => {
    catalogueMock.mockResolvedValue({ plans: [STARTER] });
    subscriptionsMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ subscriptions: [] });
    render(<PlanManager copy={COPY} />);

    const section = await screen.findByRole('region', { name: COPY.queueHeading });
    await userEvent.click(await within(section).findByRole('button', { name: COPY.tryAgain }));

    expect(await within(section).findByText(COPY.emptyQueueTitle)).toBeInTheDocument();
  });
});
