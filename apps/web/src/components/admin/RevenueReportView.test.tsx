import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RevenueReport, SubscriptionPayment, SubscriptionPaymentList } from '../../lib/admin/revenue';
import { exportSubscriptionPayments, readRevenue, readSubscriptionPayments } from '../../lib/admin/revenue';
import { RevenueReportView } from './RevenueReportView';
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

    expect(from.value).toBe('2026-08-10');
  });

  it('fills the fields from the period the service chose when the reader has not touched them', async () => {
    render(<RevenueReportView copy={COPY} />);
    await screen.findByText('98.00 AZN');

    // September in Baku: the echoed bounds are 20:00 UTC on the eve of each end, and the last
    // day shown is the day before the exclusive one.
    expect((screen.getByLabelText(COPY.fromLabel) as HTMLInputElement).value).toBe('2026-09-01');
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
