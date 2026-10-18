import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readHealth, type JobHealth, type PlatformHealth } from '../../lib/admin/health';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { healthDashboardCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralForm } from '../../lib/i18n/plurals';
import { expectNoViolations } from '../../test-axe';
import { translatorFor } from '../../test-copy';
import { HealthDashboard } from './HealthDashboard';

/**
 * `/admin/health` — AD-16.
 *
 * What is held here: jobs and providers are named in the reader's words with the identifier one
 * hover away; the worst job comes first and the count of jobs needing somebody comes from the
 * rows; a held job says why instead of a lateness, and a dead one says when it last ran; long
 * lateness is in hours or days; a provider's reason is a sentence from the catalogue; a dead
 * outbox row says what to do; the measurement is a time, and the page carries no references.
 */

const ADMIN = translatorFor('admin');
const COPY = healthDashboardCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
}));
vi.mock('../../lib/admin/health', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/health')>()),
  readHealth: vi.fn(),
}));

const readMock = vi.mocked(readHealth);

function job(name: string, overrides: Partial<JobHealth> = {}): JobHealth {
  return { name, state: 'READY', overdueBySeconds: 0, attempts: 0, status: 'HEALTHY', ...overrides };
}

const SNAPSHOT: PlatformHealth = {
  at: '2026-10-18T16:45:00Z',
  status: 'CRITICAL',
  monitored: false,
  queues: [{ name: 'outbox', waiting: 1234, dead: 2, status: 'CRITICAL' }],
  jobs: [
    job('account-anonymiser'),
    job('notification-sender', { hold: 'MAINTENANCE', lastRunAt: '2026-10-18T16:00:00Z' }),
    job('campaign-launcher', { hold: 'UNSCHEDULED' }),
    job('ledger-reconciliation', {
      state: 'DEAD',
      attempts: 5,
      lastRunAt: '2026-10-17T08:00:00Z',
      lastError: 'connection refused',
      status: 'CRITICAL',
    }),
    job('analytics-aggregator', { overdueBySeconds: 3 * 3600 + 120, status: 'CRITICAL' }),
    job('survey-nudge', { overdueBySeconds: 4 * 86_400, status: 'CRITICAL' }),
  ],
  providers: [
    { kind: 'payments', provider: 'PAYRIFF', configured: true, available: false, reason: 'CIRCUIT_OPEN', status: 'CRITICAL' },
    { kind: 'payments', provider: 'EPOINT', configured: false, available: false, reason: 'NOT_CONFIGURED', status: 'HEALTHY' },
  ],
};

function jobRow(name: string): HTMLElement {
  return screen.getByTitle(name).closest('li') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  readMock.mockResolvedValue(SNAPSHOT);
});

afterEach(cleanup);

describe('the health dashboard', () => {
  it('names jobs in the reader’s words and puts the worst first', async () => {
    render(<HealthDashboard copy={COPY} />);

    await screen.findByTitle('ledger-reconciliation');
    const jobs = within(screen.getByRole('heading', { name: COPY.jobs }).closest('section') as HTMLElement);
    const names = jobs.getAllByRole('listitem').map((item) => item.querySelector('p')?.textContent);
    expect(names.slice(0, 3)).toEqual([
      COPY.jobName['analytics-aggregator'],
      COPY.jobName['ledger-reconciliation'],
      COPY.jobName['survey-nudge'],
    ]);
    expect(screen.queryByText('ledger-reconciliation')).not.toBeInTheDocument();
    expect(jobs.getByText(fillPlaceholders(COPY.jobsAttention, { count: '3' }))).toBeInTheDocument();
  });

  it('says why a held job is not running, and grades it healthy', async () => {
    render(<HealthDashboard copy={COPY} />);

    await screen.findByTitle('notification-sender');
    expect(jobRow('notification-sender')).toHaveTextContent(COPY.hold['MAINTENANCE']!);
    expect(within(jobRow('notification-sender')).getByText(COPY.status['HEALTHY']!)).toBeInTheDocument();
    expect(jobRow('campaign-launcher')).toHaveTextContent(COPY.hold['UNSCHEDULED']!);
  });

  it('shows a dead job’s last run and attempts, not a lateness, and its error on request', async () => {
    render(<HealthDashboard copy={COPY} />);

    const row = (await screen.findByTitle('ledger-reconciliation')).closest('li') as HTMLElement;
    expect(row).toHaveTextContent(COPY.jobState['DEAD']!);
    expect(row).toHaveTextContent(fillPlaceholders(pluralForm('en', COPY.attempts, 5), { count: '5' }));
    expect(row).toHaveTextContent(/Last ran 17 Oct 2026, 12:00/);
    expect(row).not.toHaveTextContent(/late/);
    expect(within(row).getByText(COPY.status['CRITICAL']!)).toBeInTheDocument();
    expect(within(row).getByText('connection refused')).toHaveAttribute('lang', 'en');
  });

  it('gives a long lateness in hours or days', async () => {
    render(<HealthDashboard copy={COPY} />);

    await screen.findByTitle('analytics-aggregator');
    expect(jobRow('analytics-aggregator')).toHaveTextContent('3 hours late');
    expect(jobRow('survey-nudge')).toHaveTextContent('4 days late');
  });

  it('names providers under their kind and says why one is down', async () => {
    render(<HealthDashboard copy={COPY} />);

    const providers = within(
      (await screen.findByRole('heading', { name: COPY.providers })).closest('section') as HTMLElement,
    );
    expect(providers.getByRole('heading', { name: COPY.kind['payments'] })).toBeInTheDocument();
    expect(providers.getByText('Payriff')).toBeInTheDocument();
    expect(providers.getByText(COPY.reason['CIRCUIT_OPEN']!)).toBeInTheDocument();
    expect(providers.getByText(COPY.reason['NOT_CONFIGURED']!)).toBeInTheDocument();
    expect(providers.getByText(COPY.notConfigured)).toBeInTheDocument();
  });

  it('counts in the reader’s format and says what to do about a dead outbox row', async () => {
    render(<HealthDashboard copy={COPY} />);

    const outbox = (await screen.findByTitle('outbox')).closest('li') as HTMLElement;
    expect(outbox).toHaveTextContent(fillPlaceholders(COPY.waiting, { count: '1,234' }));
    expect(outbox).toHaveTextContent(fillPlaceholders(COPY.givenUp, { count: '2' }));
    expect(outbox).toHaveTextContent(COPY.givenUpHint);
  });

  it('says when it was measured as a time, and measures again on request', async () => {
    render(<HealthDashboard copy={COPY} />);

    expect(await screen.findByText(/Measured at 18 Oct 2026, 20:45/)).toBeInTheDocument();
    expect(screen.getByText(COPY.notMonitoredBody)).not.toHaveTextContent(/#|§/);

    await userEvent.click(screen.getByRole('button', { name: COPY.measureAgain }));
    expect(readMock).toHaveBeenCalledTimes(2);
  });

  it('words a critical status as needing attention, not as stopped', () => {
    expect(COPY.status['CRITICAL']).toBe('Needs attention now');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<HealthDashboard copy={COPY} />);
    await screen.findByTitle('outbox');

    await expectNoViolations(container);
  });
});
