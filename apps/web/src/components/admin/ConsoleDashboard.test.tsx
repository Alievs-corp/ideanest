import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  bakuToday,
  readDashboard,
  waitedFor,
  windowFor,
  type Dashboard,
  type DashboardSectionData,
} from '../../lib/admin/dashboard';
import type { StaffCapability } from '../../lib/admin/staff';
import { ConsoleDashboard } from './ConsoleDashboard';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { consoleDashboardCopyFrom } from '../../lib/i18n/admin/dashboard-copy';

/*
 * The copy is built from `messages/en.json` with the same builder the route calls, rather than
 * typed out here — `src/test-copy.ts` has the argument.
 */
const COPY = consoleDashboardCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

const replace = vi.fn();

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('../../lib/admin/dashboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/dashboard')>()),
  readDashboard: vi.fn(),
}));

const readMock = vi.mocked(readDashboard);

const MONEY: DashboardSectionData = {
  key: 'figures',
  status: 'READY',
  figures: [
    { key: 'pledgeVolume', kind: 'MONEY', value: '12500.50', currency: 'AZN' },
    { key: 'pledgeCount', kind: 'COUNT', value: '1234' },
    { key: 'backerCount', kind: 'COUNT', value: '310' },
    { key: 'averagePledge', kind: 'MONEY', value: '10.13', currency: 'AZN' },
    { key: 'otherCurrencyPledges', kind: 'COUNT', value: '3' },
    { key: 'campaignsSucceeded', kind: 'COUNT', value: '8' },
    { key: 'campaignsFailed', kind: 'COUNT', value: '2' },
    { key: 'successRate', kind: 'RATIO', value: '80.00' },
  ],
  series: [
    { date: '2050-06-14', amount: '100.00', count: 3 },
    { date: '2050-06-15', amount: '250.00', count: 7 },
  ],
};

const CAMPAIGNS: DashboardSectionData = {
  key: 'campaigns',
  status: 'READY',
  figures: [
    { key: 'running', kind: 'COUNT', value: '4' },
    { key: 'awaitingModeration', kind: 'COUNT', value: '2', since: new Date(Date.now() - 3 * 86_400_000).toISOString() },
    { key: 'awaitingLaunch', kind: 'COUNT', value: '1' },
    { key: 'changesRequested', kind: 'COUNT', value: '0' },
    { key: 'createdInPeriod', kind: 'COUNT', value: '5' },
    { key: 'state.LIVE', kind: 'COUNT', value: '3' },
    { key: 'state.CLOSING_WINDOW', kind: 'COUNT', value: '1' },
    { key: 'state.SUBMITTED', kind: 'COUNT', value: '2' },
    { key: 'state.DRAFT', kind: 'COUNT', value: '0' },
  ],
  series: [],
};

function page(sections: readonly DashboardSectionData[]): Dashboard {
  return {
    from: '2050-05-17',
    to: '2050-06-15',
    computedAt: '2050-06-15T10:00:00Z',
    timeZone: 'Asia/Baku',
    sections,
  };
}

function renderFor(capabilities: readonly StaffCapability[]) {
  return render(
    <ConsoleMembershipProvider
      given={{
        status: 'ready',
        membership: {
          accountId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
          staff: true,
          bootstrapped: false,
          roles: [],
          capabilities: [...capabilities],
        },
      }}
    >
      <ConsoleDashboard copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

beforeEach(() => {
  readMock.mockReset();
  replace.mockReset();
});

describe('the console front page', () => {
  it('shows the money with its figures formatted, and the success rate as a percentage', async () => {
    readMock.mockResolvedValue(page([MONEY]));

    renderFor(['VIEW_FINANCE']);
    const money = (await screen.findByRole('heading', { name: COPY.section.figures })).closest('section') as HTMLElement;

    // Formatted, never recomputed: what arrived as a decimal string is what is shown.
    expect(within(money).getByText('12,500.50 AZN')).toBeInTheDocument();
    expect(within(money).getByText('1,234')).toBeInTheDocument();
    expect(within(money).getByText('80.00%')).toBeInTheDocument();
    expect(within(money).getByText(COPY.otherCurrencyNote)).toBeInTheDocument();
  });

  it('says how long the longest wait in a queue is', async () => {
    readMock.mockResolvedValue(page([CAMPAIGNS]));

    renderFor(['MODERATE_CONTENT']);
    await screen.findByRole('heading', { name: COPY.section.campaigns });

    // The number a queue's owner acts on. Three days old, said in days.
    expect(screen.getByText('Oldest has waited 3 d')).toBeInTheDocument();
  });

  it('counts running as a figure and lists only the states that have something in them', async () => {
    readMock.mockResolvedValue(page([CAMPAIGNS]));

    renderFor(['MODERATE_CONTENT']);
    const campaigns = (await screen.findByRole('heading', { name: COPY.section.campaigns })).closest('section') as HTMLElement;

    const byState = within(campaigns).getByRole('heading', { name: COPY.byStateHeading }).parentElement as HTMLElement;
    expect(within(byState).getByText(COPY.state.LIVE)).toBeInTheDocument();
    expect(within(byState).getByText(COPY.state.CLOSING_WINDOW)).toBeInTheDocument();
    expect(within(byState).getByText(COPY.state.SUBMITTED)).toBeInTheDocument();
    // A state with nothing in it is not listed.
    expect(within(byState).queryByText(COPY.state.DRAFT)).not.toBeInTheDocument();
  });

  it('draws only the sections the service sent, so a moderator has no money card', async () => {
    readMock.mockResolvedValue(page([CAMPAIGNS]));

    renderFor(['MODERATE_CONTENT']);
    await screen.findByRole('heading', { name: COPY.section.campaigns });

    expect(screen.queryByRole('heading', { name: COPY.section.figures })).not.toBeInTheDocument();
    expect(screen.queryByText(/AZN/)).not.toBeInTheDocument();
  });

  it('draws a section it has no words for from its key, rather than dropping it', async () => {
    readMock.mockResolvedValue(
      page([
        {
          key: 'refunds',
          status: 'READY',
          figures: [{ key: 'pendingRefunds', kind: 'COUNT', value: '7' }],
          series: [],
        },
      ]),
    );

    renderFor(['VIEW_FINANCE']);

    // A module that publishes a card before its copy exists shows up plainly.
    expect(await screen.findByRole('heading', { name: 'refunds' })).toBeInTheDocument();
    expect(screen.getByText('pendingRefunds')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('says so in place when one section could not be read, and keeps the others', async () => {
    readMock.mockResolvedValue(
      page([
        MONEY,
        { key: 'campaigns', status: 'UNAVAILABLE', figures: [], series: [] },
      ]),
    );

    renderFor(['VIEW_FINANCE', 'MODERATE_CONTENT']);
    const campaigns = (await screen.findByRole('heading', { name: COPY.section.campaigns })).closest('section') as HTMLElement;

    expect(within(campaigns).getByText(COPY.unavailableTitle)).toBeInTheDocument();
    // The money card beside it is untouched.
    expect(screen.getByText('12,500.50 AZN')).toBeInTheDocument();
  });

  it('gives the trend a text alternative and a table', async () => {
    readMock.mockResolvedValue(page([MONEY]));

    renderFor(['VIEW_FINANCE']);
    await screen.findByRole('heading', { name: COPY.section.figures });

    const chart = screen.getByRole('img');
    expect(chart).toHaveAccessibleName(/2050-05-17 to 2050-06-15.*2050-06-15 250\.00 AZN/);
    await userEvent.click(screen.getByText(COPY.trendTableToggle));
    const table = screen.getByRole('table', { name: COPY.trendHeading });
    expect(within(table).getByText('2050-06-14')).toBeInTheDocument();
    expect(within(table).getByText('250.00 AZN')).toBeInTheDocument();
  });

  it('asks for the window the chosen period means, and starts on thirty days', async () => {
    readMock.mockResolvedValue(page([MONEY]));

    renderFor(['VIEW_FINANCE']);
    await screen.findByRole('heading', { name: COPY.section.figures });
    // The service's own default, so nothing is sent.
    expect(readMock.mock.calls[0]?.[0]).toEqual({});

    await userEvent.click(screen.getByRole('button', { name: COPY.period.today }));
    await waitFor(() => expect(readMock.mock.calls.length).toBeGreaterThan(1));
    const today = bakuToday();
    expect(readMock.mock.calls.at(-1)?.[0]).toEqual({ from: today, to: today });
    expect(screen.getByRole('button', { name: COPY.period.today })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends a partner, who is given nothing here, on to their own statistics', async () => {
    readMock.mockResolvedValue(page([]));

    renderFor(['VIEW_PARTNER_STATISTICS']);

    // Their landing is the scaled page that says it is their share. No real figure is on this one.
    // The router is the locale-aware one, so the path it is given carries the locale.
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('/admin/partner-statistics')));
    expect(screen.queryByText(/AZN/)).not.toBeInTheDocument();
  });

  it('tells other staff who hold none of the sections that there is nothing here for them', async () => {
    readMock.mockResolvedValue(page([]));

    renderFor(['CURATE']);

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('links to the module list and to a card’s screen only where the reader may open it', async () => {
    readMock.mockResolvedValue(page([CAMPAIGNS]));

    renderFor(['MODERATE_CONTENT']);
    await screen.findByRole('heading', { name: COPY.section.campaigns });

    expect(screen.getByRole('link', { name: COPY.modulesLink })).toHaveAttribute('href', expect.stringContaining('/admin/modules'));
    expect(screen.getByRole('link', { name: COPY.link.moderation })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.link.campaigns })).toBeInTheDocument();
  });

  it('shows an alert with a retry when the whole request fails', async () => {
    readMock.mockRejectedValue(new ApiError(500, { title: 'Broken' }));

    renderFor(['VIEW_FINANCE']);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.tryAgain })).toBeInTheDocument();
  });

  it('has no accessibility violations with money, queues and a trend on the page', async () => {
    readMock.mockResolvedValue(page([MONEY, CAMPAIGNS]));

    const { container } = renderFor(['VIEW_FINANCE', 'MODERATE_CONTENT']);
    await screen.findByRole('heading', { name: COPY.section.campaigns });

    await expectNoViolations(container);
  });
});

describe('the period helpers', () => {
  it('names the days each preset means, in Baku’s calendar', () => {
    expect(windowFor('today', '2050-06-15')).toEqual({ from: '2050-06-15', to: '2050-06-15' });
    expect(windowFor('week', '2050-06-15')).toEqual({ from: '2050-06-09', to: '2050-06-15' });
    expect(windowFor('thisMonth', '2050-06-15')).toEqual({ from: '2050-06-01', to: '2050-06-15' });
    // Thirty days is the service's own default, so it asks for nothing and lets the server say.
    expect(windowFor('month30', '2050-06-15')).toEqual({});
  });

  it('crosses a month boundary by calendar days, not by milliseconds', () => {
    expect(windowFor('week', '2050-03-03')).toEqual({ from: '2050-02-25', to: '2050-03-03' });
  });

  it('reads today in Baku, which is already tomorrow for four hours of each night in UTC', () => {
    // 21:30 UTC on the 14th is 01:30 on the 15th in Baku.
    expect(bakuToday(new Date('2050-06-14T21:30:00Z'))).toBe('2050-06-15');
    expect(bakuToday(new Date('2050-06-14T19:30:00Z'))).toBe('2050-06-14');
  });

  it('says how long ago something arrived in the largest whole unit', () => {
    const now = new Date('2050-06-15T12:00:00Z');
    expect(waitedFor('2050-06-12T12:00:00Z', now)).toEqual({ unit: 'days', amount: 3 });
    expect(waitedFor('2050-06-15T07:00:00Z', now)).toEqual({ unit: 'hours', amount: 5 });
    expect(waitedFor('2050-06-15T11:45:00Z', now)).toEqual({ unit: 'minutes', amount: 15 });
    // A clock a little behind the server's never produces a negative wait.
    expect(waitedFor('2050-06-15T12:05:00Z', now)).toEqual({ unit: 'minutes', amount: 0 });
  });
});
