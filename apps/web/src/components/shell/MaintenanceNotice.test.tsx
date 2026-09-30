import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { readStatusForRender } from '../../lib/maintenance/server';
import type { PlatformStatus } from '../../lib/maintenance/status';
import type { Locale } from '../../lib/i18n/locale';
import { resolveServerTree } from '../../test-support/server-tree';
import { MaintenanceStrip } from '../admin/MaintenanceStrip';
import MaintenancePage from '../../app/[locale]/(site)/maintenance/page';
import { MaintenanceNotice } from './MaintenanceNotice';

/**
 * The planned-maintenance notice, the maintenance page and the console's strip — #214.
 *
 * All three are server markup completed by an inline script (`lib/maintenance/script.ts`
 * tests the script). What is held here is the markup: that each says the right thing for the
 * window the status endpoint describes, in the reader's language, with every time marked for
 * the script to rewrite — and that each draws nothing at all when there is nothing to say,
 * because the notice is on every public page.
 */

const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr };
let locale: Locale = 'en';

vi.mock('next-intl/server', () => ({
  getLocale: async () => locale,
  getTranslations: async (namespace: string) => {
    const at = (key: string): unknown => {
      let node: unknown = CATALOGUES[locale];
      for (const segment of `${namespace}.${key}`.split('.')) {
        node = (node as Record<string, unknown>)[segment];
      }
      return node;
    };
    return Object.assign((key: string) => String(at(key)), { raw: at });
  },
}));

vi.mock('../../lib/maintenance/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/maintenance/server')>()),
  readStatusForRender: vi.fn(),
}));

const statusMock = vi.mocked(readStatusForRender);

const UPCOMING: PlatformStatus = {
  state: 'operational',
  maintenance: null,
  upcoming: { startsAt: '2026-10-04T22:00:00Z', endsAt: '2026-10-04T22:30:00Z' },
};

function inForce(endsAt: string | null, source: 'api' | 'edge' = 'api'): PlatformStatus {
  return {
    state: 'maintenance',
    maintenance: { startsAt: source === 'api' ? '2026-10-04T22:00:00Z' : null, endsAt, source, retryAfterSeconds: 120 },
    upcoming: null,
  };
}

async function show(node: Promise<React.ReactNode> | React.ReactNode) {
  const tree = await resolveServerTree(await node);
  return render(<>{tree}</>);
}

beforeEach(() => {
  locale = 'en';
  statusMock.mockReset();
});

afterEach(cleanup);

describe('the planned-maintenance notice', () => {
  it('is nothing at all when no window is announced, which is almost always', async () => {
    statusMock.mockResolvedValue({ state: 'operational', maintenance: null, upcoming: null });

    expect(await MaintenanceNotice()).toBeNull();
  });

  it('is nothing when the status cannot be read', async () => {
    statusMock.mockResolvedValue(null);

    expect(await MaintenanceNotice()).toBeNull();
  });

  it('announces the window in the reader’s language, times marked for their zone', async () => {
    statusMock.mockResolvedValue(UPCOMING);

    const { container } = await show(MaintenanceNotice());

    // Written first in the platform's zone, Baku: 22:00Z is 02:00 on the 5th there.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Planned maintenance on 5 October, 02:00–02:30: IdeyaNest will be briefly unavailable.',
    );
    const times = [...container.querySelectorAll('time')];
    expect(times.map((time) => time.getAttribute('data-maintenance-part'))).toEqual(['date', 'time', 'moment']);
    expect(times[2]!.getAttribute('datetime')).toBe('2026-10-04T22:30:00Z');
  });

  it('is in Azerbaijani for an Azerbaijani reader, with no suffix glued to a time', async () => {
    locale = 'az';
    statusMock.mockResolvedValue(UPCOMING);

    await show(MaintenanceNotice());

    expect(screen.getByRole('status')).toHaveTextContent('Planlı texniki xidmət: 5 oktyabr, saat 02:00–02:30.');
  });

  it('says when no end is announced', async () => {
    statusMock.mockResolvedValue({ ...UPCOMING, upcoming: { startsAt: '2026-10-04T22:00:00Z', endsAt: null } });

    await show(MaintenanceNotice());

    expect(screen.getByRole('status')).toHaveTextContent(
      'Planned maintenance starts on 5 October at 02:00. No end time has been announced yet.',
    );
  });

  it('is dismissible per window, and offers the control only once the script can act on it', async () => {
    statusMock.mockResolvedValue(UPCOMING);

    const { container } = await show(MaintenanceNotice());

    expect(container.querySelector('[data-maintenance-notice]')!.getAttribute('data-maintenance-notice')).toBe(
      '2026-10-04T22:00:00Z|2026-10-04T22:30:00Z',
    );
    const dismiss = container.querySelector('[data-maintenance-dismiss]') as HTMLButtonElement;
    expect(dismiss).toHaveAttribute('aria-label', 'Dismiss the maintenance notice');
    expect(dismiss.hidden).toBe(true);
    expect(container.querySelector('script')!.innerHTML).toContain('__ideanestMaintenance');
  });
});

describe('the maintenance page', () => {
  it('says when the reader can expect the platform back', async () => {
    statusMock.mockResolvedValue(inForce('2026-10-04T22:30:00Z'));

    const { container } = await show(MaintenancePage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('IdeyaNest is down for a short while');
    expect(screen.getByText(/Back around/)).toHaveTextContent(/^Back around (02:30|5 October, 02:30)\.$/);
    expect(container.querySelector('time')!.getAttribute('datetime')).toBe('2026-10-04T22:30:00Z');
  });

  it('says so when no end is announced', async () => {
    statusMock.mockResolvedValue(inForce(null));

    await show(MaintenancePage());

    expect(screen.getByText('No end time has been announced yet.')).toBeInTheDocument();
  });

  it('words it neutrally when the edge answered, because it cannot tell a plan from a crash', async () => {
    statusMock.mockResolvedValue(inForce(null, 'edge'));

    await show(MaintenancePage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('IdeyaNest is unavailable right now');
    expect(screen.queryByText(/planned change/)).not.toBeInTheDocument();
    expect(screen.queryByText('No end time has been announced yet.')).not.toBeInTheDocument();
  });

  it('keeps its own words when the status cannot be read', async () => {
    statusMock.mockResolvedValue(null);

    await show(MaintenancePage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('IdeyaNest is down for a short while');
    expect(screen.queryByText(/Back around/)).not.toBeInTheDocument();
  });

  it('waits for the platform and takes the reader back', async () => {
    locale = 'ru';
    statusMock.mockResolvedValue(inForce(null, 'edge'));

    const { container } = await show(MaintenancePage());
    const script = container.querySelector('script')!.innerHTML;

    expect(script).toContain('"statusUrl":"/v1/status"');
    expect(script).toContain('"page":"/ru/maintenance"');
    // The edge's Retry-After, 120 s, before the first check.
    expect(script).toContain('"firstCheckMs":120000');
  });
});

describe('the console’s maintenance strip', () => {
  it('tells staff that readers see the maintenance page while a window is in force', async () => {
    statusMock.mockResolvedValue(inForce(null));

    await show(MaintenanceStrip({ label: en.admin.maintenanceOn }));

    expect(screen.getByRole('status')).toHaveTextContent('Maintenance is on — readers see the maintenance page.');
  });

  it('is nothing otherwise, including when the status cannot be read', async () => {
    statusMock.mockResolvedValue(UPCOMING);
    expect(await MaintenanceStrip({ label: 'x' })).toBeNull();

    statusMock.mockResolvedValue(null);
    expect(await MaintenanceStrip({ label: 'x' })).toBeNull();
  });
});
