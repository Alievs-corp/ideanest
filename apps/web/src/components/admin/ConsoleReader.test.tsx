import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { lookUpNames } from '../../lib/admin/directory';
import type { StaffMembership } from '../../lib/admin/staff';
import { adminShellCopyFrom } from '../../lib/i18n/admin-copy';
import { translatorFor } from '../../test-copy';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { ConsoleReader } from './ConsoleReader';

const COPY = adminShellCopyFrom(translatorFor('admin'));

vi.mock('../../lib/admin/directory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/directory')>();
  return { ...actual, lookUpNames: vi.fn() };
});

const lookUpNamesMock = vi.mocked(lookUpNames);

const ACCOUNT = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

function member(overrides: Partial<StaffMembership> = {}): StaffMembership {
  return {
    accountId: ACCOUNT,
    staff: true,
    bootstrapped: false,
    roles: ['CURATOR'],
    capabilities: ['CURATE', 'VIEW_AUDIT'],
    ...overrides,
  };
}

function renderReader(membership: StaffMembership | null): void {
  render(
    <ConsoleMembershipProvider
      given={{ status: membership === null ? 'loading' : 'ready', membership }}
    >
      <ConsoleReader copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

/**
 * Who is reading the console — issue #405, after the membership moved to the shell.
 *
 * <p>The line used to read `GET /v1/admin/me` itself, which was right while it was the only
 * thing that wanted the answer. The gate and the rail want the same one, so the read moved up
 * to `ConsoleMembershipProvider` and this consumes it. These assert what that refactor could
 * have quietly broken: the line still appears for staff, still names the roles, and still
 * appears for nobody else.
 */
describe('the console reader line', () => {
  it('names the reader and the roles they hold', async () => {
    lookUpNamesMock.mockResolvedValue({
      accounts: [{ id: ACCOUNT, name: 'Leyla Qasımova', slug: 'leyla' }],
      projects: [],
    });

    renderReader(member());

    expect(await screen.findByText(/Leyla Qasımova/u)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(COPY.role.CURATOR as string, 'u'))).toBeInTheDocument();
  });

  it('falls back to the shortened identifier when the directory has no name', async () => {
    // The same fallback every console screen uses, and the reason the line renders at all
    // when the lookup fails: the roles are the useful half and they are already known.
    lookUpNamesMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderReader(member());

    expect(await screen.findByText(/0f1e2d3c/u)).toBeInTheDocument();
  });

  it('says nothing at all about somebody who does not work here', () => {
    // A shell is the wrong place to tell somebody they are not staff — `ConsoleGate` says it
    // once, where the screen would have been.
    renderReader(member({ staff: false, roles: [], capabilities: [] }));

    expect(screen.queryByText(/0f1e2d3c/u)).not.toBeInTheDocument();
    expect(lookUpNamesMock).not.toHaveBeenCalled();
  });

  it('says nothing before the membership has arrived', () => {
    renderReader(null);

    expect(screen.queryByText(/0f1e2d3c/u)).not.toBeInTheDocument();
  });
});
