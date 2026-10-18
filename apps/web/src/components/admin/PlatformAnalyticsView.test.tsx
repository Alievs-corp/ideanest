import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { readPlatformAnalytics, type PlatformAnalytics } from '../../lib/admin/platform-analytics';
import { PlatformAnalyticsView } from './PlatformAnalyticsView';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { platformAnalyticsCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

const COPY = platformAnalyticsCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

let routeLocale = 'en';
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: routeLocale }),
}));

vi.mock('../../lib/admin/platform-analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/platform-analytics')>()),
  readPlatformAnalytics: vi.fn(),
}));

const readMock = vi.mocked(readPlatformAnalytics);

function money(amount: string) {
  return { amount, currency: 'AZN' };
}

/** Every day of the window, as the service now sends it, with two days that had pledges. */
function analytics(overrides: Partial<PlatformAnalytics> = {}): PlatformAnalytics {
  const daily = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.UTC(2050, 4, 17 + index)).toISOString().slice(0, 10);
    const amount = day === '2050-06-14' ? '1000.00' : day === '2050-06-15' ? '1500.50' : '0.00';
    return { day, pledgeCount: amount === '0.00' ? 0 : 5, volume: money(amount) };
  });
  return {
    from: '2050-05-17',
    to: '2050-06-15',
    computedAt: '2050-06-15T10:00:00Z',
    totals: {
      pledgeCount: 1234,
      volume: money('2500.50'),
      averagePledge: money('2.03'),
      backerCount: 310,
      liveProjects: 12,
      otherCurrencyPledges: 0,
      planRevenue: money('149.00'),
      planPayments: 3,
    },
    daily,
    outcomes: { succeeded: 2, failed: 1, successRate: 2 / 3 },
    notBuilt: ['COHORTS', 'FUNNELS'],
    ...overrides,
  };
}

beforeEach(() => {
  readMock.mockReset();
  routeLocale = 'en';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the platform figures', () => {
  it('asks for the thirty days ending today in Baku, not in UTC', async () => {
    // 21:30 UTC on the 14th is already 01:30 on the 15th in Baku.
    vi.useFakeTimers({ now: new Date('2050-06-14T21:30:00Z'), toFake: ['Date'] });
    readMock.mockResolvedValue(analytics());

    render(<PlatformAnalyticsView copy={COPY} />);

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    expect(readMock.mock.calls[0]?.[0]).toBe('2050-05-17');
    expect(readMock.mock.calls[0]?.[1]).toBe('2050-06-15');
  });

  it('heads the totals with the window in the reader’s dates and says which pledges are counted', async () => {
    readMock.mockResolvedValue(analytics());

    render(<PlatformAnalyticsView copy={COPY} />);

    expect(
      await screen.findByRole('heading', {
        name: fillPlaceholders(COPY.range, { from: '17 May 2050', to: '15 Jun 2050' }),
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(COPY.populationNote)).toBeInTheDocument();
    expect(screen.getByText('2,500.50 AZN')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('draws the running campaigns under “Now”, apart from the window’s figures', async () => {
    readMock.mockResolvedValue(analytics());

    render(<PlatformAnalyticsView copy={COPY} />);

    const now = (await screen.findByRole('heading', { name: COPY.nowHeading })).closest('section') as HTMLElement;
    expect(within(now).getByText(COPY.liveProjects)).toBeInTheDocument();
    expect(within(now).getByText('12')).toBeInTheDocument();
    const totals = screen.getByRole('heading', { name: /17 May 2050/ }).closest('section') as HTMLElement;
    expect(within(totals).queryByText(COPY.liveProjects)).not.toBeInTheDocument();
  });

  it('gives the success rate to two places, as the front page does', async () => {
    readMock.mockResolvedValue(analytics());

    render(<PlatformAnalyticsView copy={COPY} />);

    const outcomes = (await screen.findByRole('heading', { name: COPY.outcomesHeading })).closest('section') as HTMLElement;
    expect(within(outcomes).getByText('66.67%')).toBeInTheDocument();
  });

  it('says nothing was decided when the rate is omitted, rather than drawing nought', async () => {
    // The service leaves a null out of the JSON.
    readMock.mockResolvedValue(analytics({ outcomes: { succeeded: 0, failed: 0 } }));

    render(<PlatformAnalyticsView copy={COPY} />);

    expect(await screen.findByText(COPY.noneClosed)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('states the pledges left out in another currency, with the count grouped', async () => {
    readMock.mockResolvedValue(
      analytics({ totals: { ...analytics().totals, otherCurrencyPledges: 1200 } }),
    );

    render(<PlatformAnalyticsView copy={COPY} />);

    expect(await screen.findByText(COPY.otherCurrencyTitle)).toBeInTheDocument();
    expect(screen.getByText(fillPlaceholders(COPY.otherCurrencyBody, { count: '1,200' }))).toBeInTheDocument();
  });

  it('presses one window button at a time and asks for that window', async () => {
    readMock.mockResolvedValue(analytics());

    render(<PlatformAnalyticsView copy={COPY} />);
    await screen.findByText(COPY.populationNote);

    const windows = screen.getByRole('group', { name: COPY.windowLegend });
    const thirty = within(windows).getByRole('button', { name: COPY.windows['30'] });
    const ninety = within(windows).getByRole('button', { name: COPY.windows['90'] });
    expect(thirty).toHaveAttribute('aria-pressed', 'true');
    expect(ninety).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(ninety);
    await waitFor(() => expect(readMock.mock.calls.length).toBe(2));
    expect(ninety).toHaveAttribute('aria-pressed', 'true');
    const [from, to] = readMock.mock.calls[1] ?? [];
    expect(Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)).toBe(89);
  });

  it('says when the figures were read', async () => {
    readMock.mockResolvedValue(analytics());

    render(<PlatformAnalyticsView copy={COPY} />);

    expect(await screen.findByText(new RegExp(`15 Jun 2050, 14:00`))).toBeInTheDocument();
  });

  it('turns a refused window into the reader’s sentence, never the service’s', async () => {
    readMock.mockRejectedValue(
      new ApiError(400, {
        code: 'INVALID_ANALYTICS_RANGE',
        title: 'That reporting window cannot be read',
        detail: 'A reporting window covers at most 366 days',
      } as never),
    );

    render(<PlatformAnalyticsView copy={COPY} />);

    expect(await screen.findByText(COPY.refusals.invalidRange as string)).toBeInTheDocument();
    expect(screen.queryByText(/366 days/)).not.toBeInTheDocument();
  });

  it('draws the cohort and funnel notes from the catalogue, without issue numbers', async () => {
    readMock.mockResolvedValue(analytics());

    render(<PlatformAnalyticsView copy={COPY} />);

    expect(await screen.findByText(COPY.notBuilt.COHORTS as string)).toBeInTheDocument();
    expect(screen.queryByText(/#313/)).not.toBeInTheDocument();
  });

  it('has no accessibility violations with every section on the page', async () => {
    readMock.mockResolvedValue(analytics({ totals: { ...analytics().totals, otherCurrencyPledges: 2 } }));

    const { container } = render(<PlatformAnalyticsView copy={COPY} />);
    await screen.findByText(COPY.populationNote);

    await expectNoViolations(container);
  });
});
