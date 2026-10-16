import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RevenueReport, SubscriptionPayment, SubscriptionPaymentList } from '../../lib/admin/revenue';
import { exportSubscriptionPayments, readRevenue, readSubscriptionPayments } from '../../lib/admin/revenue';
import { RevenueReportView } from './RevenueReportView';
import { ApiError } from '../../lib/api/problem';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { revenueReportCopyFrom } from '../../lib/i18n/admin/money-copy';

/*
 * The copy is built from `messages/en.json` with the same builder the route calls, rather than
 * typed out here — `src/test-copy.ts` has the argument. Every assertion below reads its words
 * from COPY, so renaming a label in the catalogue does not break a test about behaviour.
 */
const COPY = revenueReportCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('../../lib/admin/revenue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/revenue')>()),
  readRevenue: vi.fn(),
  readSubscriptionPayments: vi.fn(),
  exportSubscriptionPayments: vi.fn(),
}));

const revenueMock = vi.mocked(readRevenue);
const paymentsMock = vi.mocked(readSubscriptionPayments);
const exportMock = vi.mocked(exportSubscriptionPayments);

const SEPTEMBER: RevenueReport = {
  from: '2026-08-31T20:00:00Z',
  to: '2026-09-30T20:00:00Z',
  filter: {},
  currencies: [{ currency: 'AZN', gross: '98.00', reversed: '-49.00', net: '49.00', payments: 2, reversals: 1 }],
  plans: [
    { planCode: 'GROWTH', planName: 'Growth', billingPeriod: 'MONTHLY', currency: 'AZN', net: '0.00', entries: 2 },
    { planCode: 'GROWTH', planName: 'Studio', billingPeriod: 'MONTHLY', currency: 'AZN', net: '49.00', entries: 1 },
  ],
  methods: [{ method: 'BANK_TRANSFER', currency: 'AZN', net: '49.00', entries: 3 }],
};

function payment(overrides: Partial<SubscriptionPayment>): SubscriptionPayment {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    subscriptionId: '00000000-0000-4000-8000-0000000000a1',
    accountId: '00000000-0000-4000-8000-0000000000b1',
    accountEmail: 'gunel@ideanest.az',
    accountName: 'Günəl',
    planId: '00000000-0000-4000-8000-0000000000c1',
    planCode: 'GROWTH',
    planName: 'Growth',
    billingPeriod: 'MONTHLY',
    amount: '49.00',
    currency: 'AZN',
    method: 'BANK_TRANSFER',
    reference: 'KOC-2026-0431',
    note: null,
    receivedAt: '2026-09-04T08:00:00Z',
    recordedAt: '2026-09-04T08:00:00Z',
    recordedBy: null,
    reverses: null,
    reversal: false,
    ...overrides,
  };
}

const PAGE: SubscriptionPaymentList = {
  payments: [
    payment({ id: '00000000-0000-4000-8000-000000000003', amount: '-49.00', reversal: true, reverses: '00000000-0000-4000-8000-000000000001' }),
    payment({ id: '00000000-0000-4000-8000-000000000002', accountEmail: null, accountName: null, planName: 'Studio' }),
  ],
  nextCursor: 'cursor-after-two',
};

beforeEach(() => {
  revenueMock.mockReset().mockResolvedValue(SEPTEMBER);
  paymentsMock.mockReset().mockResolvedValue(PAGE);
  exportMock.mockReset();
});

describe('the totals', () => {
  it('shows what arrived, what was given back and what was kept, per currency', async () => {
    render(<RevenueReportView copy={COPY} />);

    const totals = await screen.findByRole('region', { name: COPY.totalsHeading });

    // All three, so `received + reversed = kept` is arithmetic somebody can check against a
    // bank statement rather than one figure they have to trust.
    expect(within(totals).getByText('98.00 AZN')).toBeInTheDocument();
    expect(within(totals).getByText('-49.00 AZN')).toBeInTheDocument();
    expect(within(totals).getAllByText('49.00 AZN').length).toBeGreaterThan(0);
    expect(within(totals).getByText(COPY.gross)).toBeInTheDocument();
    expect(within(totals).getByText(COPY.reversed)).toBeInTheDocument();
    expect(within(totals).getByText(COPY.net)).toBeInTheDocument();

    // Counted in words, with the plural chosen by the rules rather than a suffix.
    expect(within(totals).getByText(/2 payments/)).toBeInTheDocument();
    expect(within(totals).getByText(/1 reversal\b/)).toBeInTheDocument();
  });

  it('shows a renamed plan as two rows under one code, each under the name it had', async () => {
    render(<RevenueReportView copy={COPY} />);

    const byPlan = await screen.findByRole('region', { name: COPY.byPlanHeading });

    expect(within(byPlan).getByText('Growth')).toBeInTheDocument();
    expect(within(byPlan).getByText('Studio')).toBeInTheDocument();
    expect(within(byPlan).getAllByText('GROWTH')).toHaveLength(2);
  });

  it('says nothing was paid rather than drawing a table of zeroes', async () => {
    revenueMock.mockResolvedValue({ ...SEPTEMBER, currencies: [], plans: [], methods: [] });
    paymentsMock.mockResolvedValue({ payments: [], nextCursor: null });

    render(<RevenueReportView copy={COPY} />);

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
    // The list says it is empty rather than leaving its section blank.
    expect(await screen.findByText(COPY.listEmpty)).toBeInTheDocument();
  });

  it('blames the filter, not the period, when a plan code or a method finds nothing', async () => {
    render(<RevenueReportView copy={COPY} />);
    await screen.findByText('98.00 AZN');

    revenueMock.mockResolvedValue({ ...SEPTEMBER, filter: { planCode: 'NOPE' }, currencies: [], plans: [], methods: [] });
    paymentsMock.mockResolvedValue({ payments: [], nextCursor: null });
    fireEvent.change(screen.getByLabelText(COPY.planLabel), { target: { value: 'NOPE' } });
    await userEvent.click(screen.getByRole('button', { name: COPY.show }));

    expect(await screen.findByText(COPY.filteredTitle)).toBeInTheDocument();
    expect(screen.queryByText(COPY.emptyTitle)).not.toBeInTheDocument();
  });
});

describe('a new question', () => {
  it('says it is working, and does not leave the previous answer on screen while it does', async () => {
    render(<RevenueReportView copy={COPY} />);
    await screen.findByText('98.00 AZN');

    revenueMock.mockReturnValue(new Promise<RevenueReport>(() => undefined));
    paymentsMock.mockReturnValue(new Promise<SubscriptionPaymentList>(() => undefined));
    fireEvent.change(screen.getByLabelText(COPY.fromLabel), { target: { value: '2026-08-10' } });
    await userEvent.click(screen.getByRole('button', { name: COPY.show }));

    const button = await screen.findByRole('button', { name: COPY.loading });
    expect(button).toBeDisabled();
    // September's figures are not the answer to the question now on screen.
    expect(screen.queryByText('98.00 AZN')).not.toBeInTheDocument();
    expect(screen.queryByText('gunel@ideanest.az')).not.toBeInTheDocument();
  });

  it('says a refusal once, in the reader’s words, when both reads refuse the period', async () => {
    render(<RevenueReportView copy={COPY} />);
    await screen.findByText('98.00 AZN');

    const refusal = new ApiError(400, {
      code: 'INVALID_REVENUE_PERIOD',
      detail: 'A period covers at most 400 days; ask for a year at a time',
    });
    revenueMock.mockRejectedValue(refusal);
    paymentsMock.mockRejectedValue(refusal);
    // Only an end at a month boundary: nothing for the screen to refuse before sending.
    fireEvent.change(screen.getByLabelText(COPY.fromLabel), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(COPY.toLabel), { target: { value: '2026-09-30' } });
    await userEvent.click(screen.getByRole('button', { name: COPY.show }));

    expect(await screen.findByText(COPY.periodBackwards)).toBeInTheDocument();
    expect(screen.getAllByText(COPY.periodBackwards)).toHaveLength(1);
    expect(screen.queryByText(/400 days; ask/)).not.toBeInTheDocument();
  });

  it('refuses a period that ends before it begins without asking the service', async () => {
    render(<RevenueReportView copy={COPY} />);
    await screen.findByText('98.00 AZN');
    const asked = revenueMock.mock.calls.length;

    fireEvent.change(screen.getByLabelText(COPY.fromLabel), { target: { value: '2026-08-20' } });
    fireEvent.change(screen.getByLabelText(COPY.toLabel), { target: { value: '2026-08-10' } });
    await userEvent.click(screen.getByRole('button', { name: COPY.show }));

    expect(await screen.findByText(COPY.periodBackwards)).toBeInTheDocument();
    expect(revenueMock.mock.calls.length).toBe(asked);
  });

  it('drops a later page that belonged to the previous question', async () => {
    render(<RevenueReportView copy={COPY} />);
    await screen.findByText('gunel@ideanest.az');

    // The next page of September is slow to arrive...
    let late: (page: SubscriptionPaymentList) => void = () => undefined;
    paymentsMock.mockReturnValueOnce(new Promise<SubscriptionPaymentList>((resolve) => (late = resolve)));
    await userEvent.click(screen.getByRole('button', { name: COPY.loadMore }));

    // ...and the reader asks about August before it does.
    paymentsMock.mockResolvedValue({ payments: [payment({ id: '00000000-0000-4000-8000-0000000000aa', accountEmail: 'august@ideanest.az' })], nextCursor: null });
    fireEvent.change(screen.getByLabelText(COPY.fromLabel), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText(COPY.toLabel), { target: { value: '2026-08-31' } });
    await userEvent.click(screen.getByRole('button', { name: COPY.show }));
    await screen.findByText('august@ideanest.az');

    await act(async () =>
      late({ payments: [payment({ id: '00000000-0000-4000-8000-0000000000bb', accountEmail: 'stale@ideanest.az' })], nextCursor: 'september-3' }),
    );

    expect(screen.queryByText('stale@ideanest.az')).not.toBeInTheDocument();
    // And no cursor from September survives to be sent with August.
    expect(screen.queryByRole('button', { name: COPY.loadMore })).not.toBeInTheDocument();
  });

  it('does not keep the previous question’s cursor when the new one fails', async () => {
    render(<RevenueReportView copy={COPY} />);
    await screen.findByRole('button', { name: COPY.loadMore });

    revenueMock.mockRejectedValue(new Error('offline'));
    paymentsMock.mockRejectedValue(new Error('offline'));
    fireEvent.change(screen.getByLabelText(COPY.fromLabel), { target: { value: '2026-08-01' } });
    await userEvent.click(screen.getByRole('button', { name: COPY.show }));

    expect(await screen.findByText(COPY.refusals.unreachable)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.loadMore })).not.toBeInTheDocument();
    expect(screen.queryByText('gunel@ideanest.az')).not.toBeInTheDocument();
  });
});

describe('the payment list', () => {
  it('marks a reversal in words, and names a closed account rather than leaving a gap', async () => {
    render(<RevenueReportView copy={COPY} />);

    const list = await screen.findByRole('region', { name: COPY.listHeading });

    // Not colour alone: the tag is the word.
    expect(within(list).getByText(COPY.reversal)).toBeInTheDocument();
    expect(within(list).getByText(COPY.closedAccount)).toBeInTheDocument();
    expect(within(list).getByText('gunel@ideanest.az')).toBeInTheDocument();
    // The person, by name, beside the address.
    expect(within(list).getAllByText('Günəl').length).toBeGreaterThan(0);
  });

  it('hands the cursor back verbatim for the next page', async () => {
    render(<RevenueReportView copy={COPY} />);

    await userEvent.click(await screen.findByRole('button', { name: COPY.loadMore }));

    await waitFor(() =>
      expect(paymentsMock).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ after: 'cursor-after-two' }),
        expect.anything(),
      ),
    );
  });
});

describe('the period', () => {
  /*
   * Dates are entered with `fireEvent.change`, not `userEvent.type`. jsdom does not type into a
   * `type="date"` input the way a browser does, and the first draft of this test passed for the
   * wrong reason: typing left the field unchanged, the end date the service had echoed happened
   * to be the one the test meant to type, and the assertion on it matched by coincidence. The
   * dates below are deliberately not the echoed ones, so that cannot happen again.
   */
  it('asks for whole days in Baku, with the last day included', async () => {
    render(<RevenueReportView copy={COPY} />);
    await screen.findByText('98.00 AZN');

    fireEvent.change(screen.getByLabelText(COPY.fromLabel), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText(COPY.toLabel), { target: { value: '2026-08-20' } });
    await userEvent.click(screen.getByRole('button', { name: COPY.show }));

    // The 20th is included: the exclusive bound the service is sent is the start of the 21st.
    await waitFor(() =>
      expect(revenueMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: '2026-08-10T00:00:00+04:00', to: '2026-08-21T00:00:00+04:00' }),
        expect.anything(),
      ),
    );
  });

  it('does not overwrite a date the reader entered before the first report arrived', async () => {
    // The first report is held back, which on a slow connection is the ordinary case.
    let answer: (report: RevenueReport) => void = () => undefined;
    revenueMock.mockReturnValueOnce(new Promise<RevenueReport>((resolve) => (answer = resolve)));

    render(<RevenueReportView copy={COPY} />);
    const from = screen.getByLabelText(COPY.fromLabel) as HTMLInputElement;
    fireEvent.change(from, { target: { value: '2026-08-10' } });

    // The service's default period arrives after the reader has started. Filling the fields
    // from it now would replace their date with September's.
    await act(async () => answer(SEPTEMBER));
    await screen.findByText('98.00 AZN');
    /*
     * The fill runs in an effect one render after the figures appear, so asserting straight
     * after `findByText` would pass whether or not the effect had run — a test of nothing. A
     * macrotask inside `act` lets the effect and the render it causes happen first, so what is
     * asserted below is the value after the fill has had its chance.
     */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(from.value).toBe('2026-08-10');
  });

  it('fills the fields from the period the service chose when the reader has not touched them', async () => {
    render(<RevenueReportView copy={COPY} />);

    /*
     * Waited for rather than read after the figures appear. The fill is an effect that runs one
     * render later, and CI — slower than a laptop — asserted in between and read an empty field.
     * September in Baku: the echoed bounds are 20:00 UTC on the eve of each end, and the last
     * day shown is the day before the exclusive one.
     */
    await waitFor(() =>
      expect((screen.getByLabelText(COPY.fromLabel) as HTMLInputElement).value).toBe('2026-09-01'),
    );
    expect((screen.getByLabelText(COPY.toLabel) as HTMLInputElement).value).toBe('2026-09-30');
  });
});

describe('the export', () => {
  it('says when the file is short, instead of offering it as if it were complete', async () => {
    exportMock.mockResolvedValue({ filename: 'subscription-revenue.csv', csv: 'x', rows: 5000, truncated: true });
    const offerFile = vi.fn();

    render(<RevenueReportView copy={COPY} offerFile={offerFile} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.exportCsv }));

    expect(await screen.findByText(COPY.truncated.replace('{count}', '5000'))).toBeInTheDocument();
    expect(offerFile).toHaveBeenCalledWith('subscription-revenue.csv', 'x');
  });

  it('counts a complete file in words', async () => {
    exportMock.mockResolvedValue({ filename: 'subscription-revenue.csv', csv: 'x', rows: 1, truncated: false });

    render(<RevenueReportView copy={COPY} offerFile={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.exportCsv }));

    expect(await screen.findByText('Downloaded 1 payment.')).toBeInTheDocument();
  });
});
