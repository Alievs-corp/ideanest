import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { lookUpNames } from '../../lib/admin/directory';
import {
  ROLE_CAPABILITIES,
  STAFF_CAPABILITIES,
  changeRoleCapabilities,
  readMembership,
  readRoleMatrix,
  readRoster,
  type RoleCapabilitySet,
  type StaffMembership,
  type StaffRole,
} from '../../lib/admin/staff';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { staffRolesCopyFrom } from '../../lib/i18n/admin/people-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { StaffRoles } from './StaffRoles';

/**
 * `/admin/staff`'s first panel: a super admin's role editor, and everybody else's own list — V114.
 *
 * <p>The service is mocked at `lib/admin/staff`; what is asserted is what the editor sends and
 * what it then says, because the server's own rules are `RoleCapabilitiesApiTests`'s.
 */

vi.mock('../../lib/admin/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/staff')>()),
  readMembership: vi.fn(),
  readRoster: vi.fn(),
  readRoleMatrix: vi.fn(),
  changeRoleCapabilities: vi.fn(),
}));

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const COPY = staffRolesCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

const READER = '0191f2ab-0000-7000-8000-000000000001';
const ADJUSTABLE = STAFF_CAPABILITIES.filter(
  (capability) => capability !== 'ADMINISTER_STAFF' && capability !== 'VIEW_PARTNER_STATISTICS',
);

function member(roles: StaffRole[]): StaffMembership {
  return {
    accountId: READER,
    staff: true,
    bootstrapped: false,
    roles,
    capabilities: [...new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role]))],
  };
}

function set(role: StaffRole, capabilities = [...ROLE_CAPABILITIES[role]]): RoleCapabilitySet {
  return { role, capabilities, defaults: [...ROLE_CAPABILITIES[role]], adjustable: [...ADJUSTABLE] };
}

/**
 * A checkbox by its label. The kit's `Checkbox` draws the description inside the `<label>`, so the
 * accessible name is the label followed by the pages it opens; the label is how it starts.
 */
function box(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

const ROLES: StaffRole[] = ['MODERATOR', 'CURATOR', 'FINANCE', 'COMPLIANCE'];

beforeEach(() => {
  vi.mocked(readRoster).mockResolvedValue({ grants: [] });
  vi.mocked(readRoleMatrix).mockResolvedValue({ roles: ROLES.map((role) => set(role)) });
  vi.mocked(lookUpNames).mockResolvedValue({ accounts: [], projects: [] } as never);
  vi.mocked(changeRoleCapabilities).mockReset();
});

describe('the role editor on the staff screen', () => {
  it('shows a super admin each role as checkboxes, with the pages each capability opens', async () => {
    vi.mocked(readMembership).mockResolvedValue(member(['SUPER_ADMIN']));
    render(<StaffRoles copy={COPY} />);

    expect(await screen.findByRole('heading', { name: COPY.editor.heading })).toBeInTheDocument();
    // The moderator is first, and what it holds by default is ticked.
    const moderate = await screen.findByRole('checkbox', { name: box(COPY.capability.MODERATE_CONTENT) });
    expect(moderate).toBeChecked();
    expect(screen.getByRole('checkbox', { name: box(COPY.capability.CURATE) })).not.toBeChecked();
    // Never offered: these stay with super admins and partners.
    expect(screen.queryByRole('checkbox', { name: box(COPY.capability.ADMINISTER_STAFF) })).toBeNull();
    // The pages, in the rail's own words.
    expect(screen.getAllByText(new RegExp(COPY.editor.links['/admin/curation/badges'] ?? '')).length).toBeGreaterThan(0);
    // A super admin's own list of twenty-one capabilities is not drawn; the editor replaces it.
    expect(screen.queryByRole('heading', { name: COPY.myHeading })).toBeNull();
  });

  it('saves the role on screen with exactly what is ticked, and says so', async () => {
    const user = userEvent.setup();
    vi.mocked(readMembership).mockResolvedValue(member(['SUPER_ADMIN']));
    vi.mocked(changeRoleCapabilities).mockResolvedValue(set('CURATOR', ['CURATE', 'VIEW_AUDIT', 'VIEW_HEALTH']));
    render(<StaffRoles copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.role.CURATOR }));
    const save = screen.getByRole('button', { name: COPY.editor.save });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: box(COPY.capability.VIEW_HEALTH) }));
    expect(screen.getByText(COPY.editor.unsaved)).toBeInTheDocument();
    await user.click(save);

    expect(changeRoleCapabilities).toHaveBeenCalledWith('CURATOR', ['CURATE', 'VIEW_AUDIT', 'VIEW_HEALTH']);
    expect(
      await screen.findByText(fillPlaceholders(COPY.editor.saved, { role: COPY.role.CURATOR })),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: box(COPY.capability.VIEW_HEALTH) })).toBeChecked();
    expect(screen.queryByText(COPY.editor.unsaved)).toBeNull();
  });

  it('puts a changed role back to its defaults with one press, before saving', async () => {
    const user = userEvent.setup();
    vi.mocked(readMembership).mockResolvedValue(member(['SUPER_ADMIN']));
    vi.mocked(readRoleMatrix).mockResolvedValue({
      roles: ROLES.map((role) => (role === 'MODERATOR' ? set(role, ['MODERATE_CONTENT']) : set(role))),
    });
    render(<StaffRoles copy={COPY} />);

    expect(await screen.findByRole('checkbox', { name: box(COPY.capability.VIEW_AUDIT) })).not.toBeChecked();
    expect(screen.getAllByText(new RegExp(COPY.editor.changed)).length).toBe(3);

    await user.click(screen.getByRole('button', { name: COPY.editor.reset }));

    expect(screen.getByRole('checkbox', { name: box(COPY.capability.VIEW_AUDIT) })).toBeChecked();
    expect(screen.queryByText(new RegExp(COPY.editor.changed))).toBeNull();
    expect(screen.getByRole('button', { name: COPY.editor.save })).toBeEnabled();
  });

  it('keeps the edit and says why when the service refuses it', async () => {
    const user = userEvent.setup();
    vi.mocked(readMembership).mockResolvedValue(member(['SUPER_ADMIN']));
    vi.mocked(changeRoleCapabilities).mockRejectedValue(
      new ApiError(422, { code: 'CAPABILITY_NOT_ADJUSTABLE' } as never, 'refused'),
    );
    render(<StaffRoles copy={COPY} />);

    await user.click(await screen.findByRole('checkbox', { name: box(COPY.capability.VIEW_HEALTH) }));
    await user.click(screen.getByRole('button', { name: COPY.editor.save }));

    expect(await screen.findByText(COPY.errors.CAPABILITY_NOT_ADJUSTABLE ?? '')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: box(COPY.capability.VIEW_HEALTH) })).toBeChecked();
  });

  it('shows everybody else their own list, read-only, and never asks for the roles', async () => {
    vi.mocked(readMembership).mockResolvedValue(member(['MODERATOR']));
    render(<StaffRoles copy={COPY} />);

    expect(await screen.findByRole('heading', { name: COPY.myHeading })).toBeInTheDocument();
    // Twice: their own list, and the grant form's preview of the role it starts on.
    expect((await screen.findAllByText(COPY.capability.MODERATE_CONTENT)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(readRoleMatrix).not.toHaveBeenCalled();
  });
});
