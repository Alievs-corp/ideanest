import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  cancelWindow,
  changeWindowEnd,
  endWindowNow,
  readMaintenance,
  scheduleWindow,
  startWindowNow,
  type MaintenanceOverview,
  type MaintenanceWindow,
} from '../../lib/admin/maintenance';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { maintenanceConsoleCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { translatorFor } from '../../test-copy';
import { MaintenanceConsole } from './MaintenanceConsole';

/**
 * `/admin/maintenance` — §19.6, issue #214.
 *
 * What is held here: each verb is offered only in the state the service accepts it in, the
 * two that shut readers out or let them back in ask first, a refusal is worded from the
 * catalogue by its code, and the console's strip is redrawn after every change.
 */

const COPY = maintenanceConsoleCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

const refresh = vi.fn();

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));

vi.mock('../../lib/admin/maintenance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/maintenance')>()),
  readMaintenance: vi.fn(),
  scheduleWindow: vi.fn(),
  startWindowNow: vi.fn(),
  endWindowNow: vi.fn(),
  changeWindowEnd: vi.fn(),
  cancelWindow: vi.fn(),
}));

const readMock = vi.mocked(readMaintenance);

const ANNOUNCED: MaintenanceWindow = {
  id: '11111111-0000-4000-8000-000000000001',
  state: 'ANNOUNCED',
  startsAt: '2026-10-04T22:00:00Z',
  endsAt: '2026-10-04T22:30:00Z',
  announceFrom: '2026-10-03T22:00:00Z',
  note: 'Postgres 18 upgrade. Ask Aysel.',
  createdAt: '2026-10-01T09:00:00Z',
  endedAt: null,
  cancelledAt: null,
};

const ACTIVE: MaintenanceWindow = {
  ...ANNOUNCED,
  id: '11111111-0000-4000-8000-000000000002',
  state: 'ACTIVE',
  endsAt: null,
  note: null,
};

const ENDED: MaintenanceWindow = {
  ...ANNOUNCED,
  id: '11111111-0000-4000-8000-000000000003',
  state: 'ENDED',
  endedAt: '2026-10-04T22:20:00Z',
};

function ready(overview: Partial<MaintenanceOverview> = {}) {
  readMock.mockResolvedValue({ current: null, upcoming: [], recent: [], ...overview });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function section(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement;
}

describe('the maintenance console', () => {
  it('lists what is in force, what is scheduled and what is over', async () => {
    ready({ current: ACTIVE, upcoming: [ANNOUNCED], recent: [ENDED] });

    render(<MaintenanceConsole copy={COPY} />);

    await screen.findByRole('heading', { name: COPY.currentHeading });
    expect(within(section(COPY.currentHeading)).getByText(COPY.state['ACTIVE']!)).toBeInTheDocument();
    expect(within(section(COPY.currentHeading)).getByText(COPY.untilFurtherNotice)).toBeInTheDocument();
    expect(within(section(COPY.upcomingHeading)).getByText(ANNOUNCED.note!)).toBeInTheDocument();
    expect(within(section(COPY.recentHeading)).getByText(COPY.endedLabel, { selector: 'dt' })).toBeInTheDocument();
  });

  it('says so when nothing is in force or scheduled', async () => {
    ready();

    render(<MaintenanceConsole copy={COPY} />);

    expect(await screen.findByText(COPY.currentEmpty)).toBeInTheDocument();
    expect(screen.getByText(COPY.upcomingEmpty)).toBeInTheDocument();
  });

  it('offers each verb only where the service accepts it', async () => {
    ready({ current: ACTIVE, upcoming: [ANNOUNCED], recent: [ENDED] });

    render(<MaintenanceConsole copy={COPY} />);
    await screen.findByRole('heading', { name: COPY.currentHeading });

    const current = within(section(COPY.currentHeading));
    expect(current.getByRole('button', { name: COPY.endNow })).toBeInTheDocument();
    expect(current.queryByRole('button', { name: COPY.startNow })).not.toBeInTheDocument();
    expect(current.queryByRole('button', { name: COPY.cancelWindow })).not.toBeInTheDocument();

    const upcoming = within(section(COPY.upcomingHeading));
    expect(upcoming.getByRole('button', { name: COPY.startNow })).toBeInTheDocument();
    expect(upcoming.getByRole('button', { name: COPY.cancelWindow })).toBeInTheDocument();
    expect(upcoming.queryByRole('button', { name: COPY.endNow })).not.toBeInTheDocument();

    expect(within(section(COPY.recentHeading)).queryAllByRole('button')).toHaveLength(0);
  });

  it('asks before starting a window, and starts it only on the second press', async () => {
    ready({ upcoming: [ANNOUNCED] });
    vi.mocked(startWindowNow).mockResolvedValue({ ...ANNOUNCED, state: 'ACTIVE' });

    render(<MaintenanceConsole copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.startNow }));

    expect(startWindowNow).not.toHaveBeenCalled();
    expect(screen.getByText(COPY.startNowConfirm)).toBeInTheDocument();
    // Focus lands on the answer, so the question cannot be missed by somebody who cannot see it.
    expect(screen.getByRole('button', { name: COPY.startNowYes })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: COPY.startNowYes }));

    expect(startWindowNow).toHaveBeenCalledWith(ANNOUNCED.id);
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2));
    // The console shell's strip is server markup; the route is redrawn so it follows.
    expect(refresh).toHaveBeenCalled();
  });

  it('asks before ending one, and "not now" leaves it running', async () => {
    ready({ current: ACTIVE });

    render(<MaintenanceConsole copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.endNow }));
    expect(screen.getByText(COPY.endNowConfirm)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: COPY.keep }));

    expect(endWindowNow).not.toHaveBeenCalled();
    expect(screen.queryByText(COPY.endNowConfirm)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: COPY.endNow }));
    vi.mocked(endWindowNow).mockResolvedValue({ ...ACTIVE, state: 'ENDED' });
    await userEvent.click(screen.getByRole('button', { name: COPY.endNowYes }));
    expect(endWindowNow).toHaveBeenCalledWith(ACTIVE.id);
  });

  it('extends a window, or makes its end open', async () => {
    ready({ upcoming: [ANNOUNCED] });
    vi.mocked(changeWindowEnd).mockResolvedValue(ANNOUNCED);

    render(<MaintenanceConsole copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.changeEnd }));
    await userEvent.click(screen.getByRole('checkbox', { name: COPY.openEndLabel }));
    await userEvent.click(screen.getByRole('button', { name: COPY.saveEnd }));

    expect(changeWindowEnd).toHaveBeenCalledWith(ANNOUNCED.id, null);
  });

  it('cancels a window that has not started', async () => {
    ready({ upcoming: [ANNOUNCED] });
    vi.mocked(cancelWindow).mockResolvedValue();

    render(<MaintenanceConsole copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.cancelWindow }));

    expect(cancelWindow).toHaveBeenCalledWith(ANNOUNCED.id);
  });

  it('schedules a window from the times typed, in the typist’s own zone', async () => {
    ready();
    vi.mocked(scheduleWindow).mockResolvedValue(ANNOUNCED);

    const { container } = render(<MaintenanceConsole copy={COPY} />);
    await screen.findByText(COPY.currentEmpty);

    const [starts, ends] = [...container.querySelectorAll('input[type="datetime-local"]')] as HTMLInputElement[];
    await userEvent.type(starts!, '2026-10-05T02:00');
    await userEvent.type(ends!, '2026-10-05T02:30');
    await userEvent.type(screen.getByRole('textbox', { name: new RegExp(COPY.noteFieldLabel) }), 'Upgrade');
    await userEvent.click(screen.getByRole('button', { name: COPY.schedule }));

    expect(scheduleWindow).toHaveBeenCalledWith({
      startsAt: new Date('2026-10-05T02:00').toISOString(),
      endsAt: new Date('2026-10-05T02:30').toISOString(),
      announceFrom: null,
      note: 'Upgrade',
    });
  });

  it('words a refusal from the catalogue by its code', async () => {
    ready();
    vi.mocked(scheduleWindow).mockRejectedValue(
      new ApiError(409, { status: 409, code: 'MAINTENANCE_WINDOW_OVERLAPS', detail: 'English detail' }),
    );

    const { container } = render(<MaintenanceConsole copy={COPY} />);
    await screen.findByText(COPY.currentEmpty);
    const starts = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await userEvent.type(starts, '2026-10-05T02:00');
    await userEvent.click(screen.getByRole('button', { name: COPY.schedule }));

    expect(await screen.findByText(COPY.refusal['MAINTENANCE_WINDOW_OVERLAPS']!)).toBeInTheDocument();
    // Kept, so an overlap is fixed by moving one field rather than typing four again.
    expect(starts.value).toBe('2026-10-05T02:00');
  });

  it('refuses a reader without CONFIGURE_PLATFORM with the console’s own refusal', async () => {
    readMock.mockRejectedValue(
      new ApiError(403, { status: 403, code: 'INSUFFICIENT_STAFF_CAPABILITY', meta: { capability: 'CONFIGURE_PLATFORM' } }),
    );

    render(<MaintenanceConsole copy={COPY} />);

    expect(await screen.findByText(/CONFIGURE_PLATFORM/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: COPY.scheduleHeading })).not.toBeInTheDocument();
  });
});
