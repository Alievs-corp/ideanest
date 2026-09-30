import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ApiError } from '../../lib/api/problem';
import {
  readPartnerStatistics,
  type PartnerStatistics,
} from '../../lib/admin/partnerStatistics';
import { PartnerStatisticsView } from './PartnerStatisticsView';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { partnerStatisticsCopyFrom } from '../../lib/i18n/admin/partner-copy';

const COPY = partnerStatisticsCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/partnerStatistics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/partnerStatistics')>()),
  readPartnerStatistics: vi.fn(),
}));

const readMock = vi.mocked(readPartnerStatistics);

function figures(revenue: string, subscriptions: string, reversals = '0.00') {
  return { currency: 'AZN', revenue, subscriptions, reversals };
}

/** A partner's answer: the service has already scaled every figure. */
const PARTNER_VIEW: PartnerStatistics = {
  view: 'PARTNER',
  sharePercentage: '50.00',
  generatedAt: '2050-06-15T10:00:00Z',
  timeZone: 'Asia/Baku',
  today: { date: '2050-06-15', currencies: [figures('100.00', '1.50')] },
  thisMonth: { month: '2050-06', currencies: [figures('250.00', '3.50', '0.50')] },
  daily: [
    { date: '2050-06-03', currencies: [figures('200.00', '2.00')] },
    { date: '2050-06-15', currencies: [figures('100.00', '1.50')] },
  ],
  monthly: [{ month: '2050-05', currencies: [figures('49.00', '1.00')] }],
  byPlan: [
    {
      planCode: 'GROWTH',
      planName: 'Growth',
      currency: 'AZN',
      revenue: '49.00',
      subscriptions: '1.00',
      reversals: '0.00',
    },
  ],
};

const REAL_VIEW: PartnerStatistics = { ...PARTNER_VIEW, view: 'REAL', sharePercentage: '100.00' };

describe('the partner statistics', () => {
  it("says once, in the header, that a partner's figures are their share", async () => {
    readMock.mockResolvedValue({ kind: 'ready', statistics: PARTNER_VIEW });

    render(<PartnerStatisticsView copy={COPY} />);

    expect(await screen.findByText('Partner’s share: 50% of the platform’s figures.')).toBeInTheDocument();
    // Said once and never repeated beside a number.
    expect(screen.getAllByText(/Partner’s share/)).toHaveLength(1);
  });

  it('tells a super admin the figures are the real ones, and not that they are a share', async () => {
    readMock.mockResolvedValue({ kind: 'ready', statistics: REAL_VIEW });

    render(<PartnerStatisticsView copy={COPY} />);

    expect(await screen.findByText(COPY.realLine)).toBeInTheDocument();
    // Nobody reads a whole as a share or a share as a whole.
    expect(screen.queryByText(/Partner’s share/)).not.toBeInTheDocument();
  });

  it('shows the figures exactly as the service scaled them, fractions included', async () => {
    readMock.mockResolvedValue({ kind: 'ready', statistics: PARTNER_VIEW });

    render(<PartnerStatisticsView copy={COPY} />);
    const month = (await screen.findByRole('heading', { name: COPY.monthHeading })).closest('section') as HTMLElement;

    // Formatted, never recomputed: 250.00 is what arrived, and 3.50 subscriptions is what it
    // says, because a partner's count can be fractional.
    expect(within(month).getByText('250.00 AZN')).toBeInTheDocument();
    expect(within(month).getByText('3.50')).toBeInTheDocument();
    expect(within(month).getByText('0.50')).toBeInTheDocument();
  });

  it('lists the days, the months and the plans as tables with names', async () => {
    readMock.mockResolvedValue({ kind: 'ready', statistics: PARTNER_VIEW });

    render(<PartnerStatisticsView copy={COPY} />);
    await screen.findByText(COPY.todayHeading);

    const daily = screen.getByRole('table', { name: COPY.dailyCaption });
    expect(within(daily).getByText('2050-06-03')).toBeInTheDocument();
    expect(within(daily).getByText('200.00 AZN')).toBeInTheDocument();

    const monthly = screen.getByRole('table', { name: COPY.monthlyCaption });
    expect(within(monthly).getByText('2050-05')).toBeInTheDocument();

    const plans = screen.getByRole('table', { name: COPY.planCaption });
    expect(within(plans).getByText('Growth')).toBeInTheDocument();
  });

  it('draws no transaction, payer or reference, because the response has none to draw', async () => {
    readMock.mockResolvedValue({ kind: 'ready', statistics: PARTNER_VIEW });

    const { container } = render(<PartnerStatisticsView copy={COPY} />);
    await screen.findByText(COPY.todayHeading);

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/SECRET|@|reference|payer|transaction/i);
  });

  it('says so when nothing was recorded rather than drawing an empty table', async () => {
    readMock.mockResolvedValue({
      kind: 'ready',
      statistics: {
        ...PARTNER_VIEW,
        today: { date: '2050-06-15', currencies: [] },
        thisMonth: { month: '2050-06', currencies: [] },
        daily: [],
        monthly: [],
        byPlan: [],
      },
    });

    render(<PartnerStatisticsView copy={COPY} />);
    await screen.findByText(COPY.todayHeading);

    expect(screen.getAllByText(COPY.nothingRecorded).length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it("tells a partner with no percentage what to do, and does not say they don't work here", async () => {
    readMock.mockResolvedValue({ kind: 'not-configured' });

    render(<PartnerStatisticsView copy={COPY} />);

    expect(await screen.findByText(COPY.notConfiguredTitle)).toBeInTheDocument();
    expect(screen.getByText(COPY.notConfiguredBody)).toBeInTheDocument();
    expect(screen.queryByText(COPY.refusals.forbiddenTitle)).not.toBeInTheDocument();
  });

  it('refuses honestly when the reader is neither a super admin nor a partner', async () => {
    readMock.mockRejectedValue(new ApiError(403, { code: 'INSUFFICIENT_STAFF_CAPABILITY' }));

    render(<PartnerStatisticsView copy={COPY} />);

    expect(await screen.findByText(COPY.refusals.forbiddenTitle)).toBeInTheDocument();
  });
});
