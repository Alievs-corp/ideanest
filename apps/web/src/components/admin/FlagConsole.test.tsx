import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { listUsers, type AdminUser } from '../../lib/admin/api';
import { lookUpNames } from '../../lib/admin/directory';
import { createFlag, readFlags, saveFlag, type FeatureFlag } from '../../lib/admin/flags';
import type { StaffCapability } from '../../lib/admin/staff';
import { ApiError } from '../../lib/api/problem';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { flagConsoleCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { expectNoViolations } from '../../test-axe';
import { translatorFor } from '../../test-copy';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { FlagConsole } from './FlagConsole';

/**
 * `/admin/flags` — AD-12.
 *
 * What is held here: the screen says nothing reads a flag yet; a flag that is on but reaches
 * nobody says so; the switch and the rollout buttons are named by the flag and say which value
 * is set, including one no button offers; widening asks first and narrowing does not; a save
 * sends the version it was made from and a stale one reloads the list and says why in the row;
 * the add form never overwrites, refuses a blank description in words, and creates off; the
 * named accounts are shown by name and can be changed only with the directory permission.
 */

const ADMIN = translatorFor('admin');
const COPY = flagConsoleCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
}));
vi.mock('../../lib/admin/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/flags')>()),
  readFlags: vi.fn(),
  saveFlag: vi.fn(),
  createFlag: vi.fn(),
}));
vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));
vi.mock('../../lib/admin/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/api')>()),
  listUsers: vi.fn(),
}));

const readMock = vi.mocked(readFlags);
const saveMock = vi.mocked(saveFlag);
const createMock = vi.mocked(createFlag);

const EDITOR = '00000000-0000-4000-8000-0000000000e1';
const AYSEL = '00000000-0000-4000-8000-0000000000a1';
const RASHAD: AdminUser = {
  id: '00000000-0000-4000-8000-0000000000b2',
  email: 'rashad@example.com',
  name: 'Rashad Aliyev',
  slug: 'rashad',
  emailVerified: true,
  emailVerifiedAt: null,
  suspended: false,
} as AdminUser;

const OFF: FeatureFlag = {
  key: 'checkout-v2',
  description: 'The rebuilt checkout',
  enabled: false,
  rolloutPercentage: 0,
  enabledAccounts: [],
  updatedAt: '2026-10-14T21:30:00Z',
  updatedBy: EDITOR,
  version: 3,
};

function ready(...flags: FeatureFlag[]) {
  readMock.mockResolvedValue({ flags });
}

function renderAs(capabilities: StaffCapability[] = ['CONFIGURE_PLATFORM', 'ADMINISTER_ACCOUNTS']) {
  return render(
    <ConsoleMembershipProvider
      given={{
        status: 'ready',
        membership: { accountId: EDITOR, staff: true, bootstrapped: false, roles: [], capabilities },
      }}
    >
      <FlagConsole copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

function row(key: string): HTMLElement {
  return screen.getByText(key, { selector: 'p' }).closest('li') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookUpNames).mockResolvedValue({
    accounts: [
      { id: EDITOR, name: 'Nigar Mammadova', slug: 'nigar' },
      { id: AYSEL, name: 'Aysel Huseynova', slug: 'aysel' },
    ],
    projects: [],
  });
});

afterEach(cleanup);

describe('the flags screen', () => {
  it('says that nothing reads a flag yet', async () => {
    ready(OFF);
    renderAs();

    expect(await screen.findByText(COPY.notReadTitle)).toBeInTheDocument();
    expect(screen.getByText(COPY.notReadBody)).toBeInTheDocument();
  });

  it('names the switch by the flag and says who it reaches, including nobody', async () => {
    ready({ ...OFF, enabled: true });
    renderAs();

    const toggle = await screen.findByRole('switch', { name: 'checkout-v2' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(within(row('checkout-v2')).getByText(COPY.reach['nobody']!)).toBeInTheDocument();
  });

  it('marks the rollout that is set, and prints one no button offers', async () => {
    ready({ ...OFF, enabled: true, rolloutPercentage: 5 });
    renderAs();

    const group = await screen.findByRole('group', { name: fillPlaceholders(COPY.rolloutGroup, { flag: 'checkout-v2' }) });
    for (const button of within(group).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    expect(within(row('checkout-v2')).getByText(fillPlaceholders(COPY.rolloutNow, { percent: '5%' }))).toBeInTheDocument();
  });

  it('asks before switching a flag on that reaches people, and saves from the version read', async () => {
    ready({ ...OFF, rolloutPercentage: 25 });
    saveMock.mockResolvedValue({ ...OFF, enabled: true, rolloutPercentage: 25, version: 4 });
    renderAs();

    await userEvent.click(await screen.findByRole('switch', { name: 'checkout-v2' }));
    expect(saveMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: fillPlaceholders(COPY.confirmLabel, { flag: 'checkout-v2' }) });
    expect(within(confirm).getByRole('button', { name: COPY.confirmYes })).toHaveFocus();

    await userEvent.click(within(confirm).getByRole('button', { name: COPY.confirmYes }));

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'checkout-v2', enabled: true, rolloutPercentage: 25 }),
      3,
    );
    expect(await screen.findByRole('switch', { name: 'checkout-v2' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches a flag off in one press', async () => {
    ready({ ...OFF, enabled: true, rolloutPercentage: 100 });
    saveMock.mockResolvedValue({ ...OFF, version: 4 });
    renderAs();

    await userEvent.click(await screen.findByRole('switch', { name: 'checkout-v2' }));

    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, rolloutPercentage: 100 }), 3);
    expect(screen.queryByRole('button', { name: COPY.confirmYes })).not.toBeInTheDocument();
  });

  it('asks before widening a rollout, and "not now" saves nothing', async () => {
    ready({ ...OFF, enabled: true, rolloutPercentage: 10 });
    renderAs();

    await userEvent.click(await screen.findByRole('button', { name: '100%' }));
    expect(screen.getByRole('button', { name: COPY.confirmYes })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: COPY.keep }));

    expect(saveMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: COPY.confirmYes })).not.toBeInTheDocument();
  });

  it('reloads and explains in the row when somebody else saved first', async () => {
    ready({ ...OFF, enabled: true, rolloutPercentage: 50 });
    saveMock.mockRejectedValue(new ApiError(409, { status: 409, code: 'FEATURE_FLAG_CHANGED', detail: 'English' }));
    renderAs();

    await userEvent.click(await screen.findByRole('button', { name: '10%' }));

    expect(await within(row('checkout-v2')).findByText(COPY.errors['FEATURE_FLAG_CHANGED']!)).toBeInTheDocument();
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('English')).not.toBeInTheDocument();
  });

  it('names a refused write by the capability it needs', async () => {
    ready({ ...OFF, enabled: true, rolloutPercentage: 50 });
    saveMock.mockRejectedValue(
      new ApiError(403, { status: 403, code: 'INSUFFICIENT_STAFF_CAPABILITY', meta: { capability: 'CONFIGURE_PLATFORM' } }),
    );
    renderAs();

    await userEvent.click(await screen.findByRole('button', { name: '0%' }));

    expect(await within(row('checkout-v2')).findByText(/CONFIGURE_PLATFORM/)).toBeInTheDocument();
  });

  it('shows the named accounts and who changed it last by name, in the reader’s time', async () => {
    ready({ ...OFF, enabledAccounts: [AYSEL] });
    renderAs();

    expect(await screen.findByText('Aysel Huseynova')).toBeInTheDocument();
    expect(within(row('checkout-v2')).getByText('Aysel Huseynova')).toBeInTheDocument();
    // 21:30 UTC is 01:30 the next day in Baku.
    expect(within(row('checkout-v2')).getByText(/Nigar Mammadova/)).toHaveTextContent(/15 Oct 2026, 01:30/);
  });

  it('adds an account from the directory and takes one out', async () => {
    ready({ ...OFF, enabledAccounts: [AYSEL] });
    vi.mocked(listUsers).mockResolvedValue({ users: [RASHAD], nextCursor: null });
    saveMock.mockResolvedValue({ ...OFF, enabledAccounts: [AYSEL, RASHAD.id], version: 4 });
    renderAs();

    const flag = await screen.findByText('checkout-v2', { selector: 'p' });
    const item = flag.closest('li') as HTMLElement;
    await userEvent.type(within(item).getByRole('textbox', { name: COPY.picker.label }), 'Rashad');
    await userEvent.click(within(item).getByRole('button', { name: COPY.picker.search }));
    await userEvent.click(await within(item).findByRole('button', { name: /Rashad Aliyev/ }));

    // The flag is off, so naming somebody shows them nothing yet: no question.
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ enabledAccounts: [AYSEL, RASHAD.id] }), 3);

    saveMock.mockResolvedValue({ ...OFF, enabledAccounts: [RASHAD.id], version: 5 });
    await userEvent.click(
      await screen.findByRole('button', {
        name: fillPlaceholders(COPY.removeAccountLabel, { name: 'Aysel Huseynova', flag: 'checkout-v2' }),
      }),
    );
    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabledAccounts: [RASHAD.id] }), 4);
  });

  it('shows the accounts read-only to a reader who cannot search the directory', async () => {
    ready({ ...OFF, enabledAccounts: [AYSEL] });
    renderAs(['CONFIGURE_PLATFORM']);

    expect(await screen.findByText('Aysel Huseynova')).toBeInTheDocument();
    expect(screen.getByText(COPY.accountsReadOnly)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aysel Huseynova/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: COPY.picker.label })).not.toBeInTheDocument();
  });

  it('edits the description', async () => {
    ready(OFF);
    saveMock.mockResolvedValue({ ...OFF, description: 'The new checkout', version: 4 });
    renderAs();

    await userEvent.click(await screen.findByRole('button', { name: COPY.editDescription }));
    const field = within(row('checkout-v2')).getByRole('textbox', { name: new RegExp(COPY.switchesLabel) });
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: COPY.saveDescription }));
    expect(screen.getByText(COPY.descriptionRequired)).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();

    await userEvent.type(field, 'The new checkout');
    await userEvent.click(screen.getByRole('button', { name: COPY.saveDescription }));

    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ description: 'The new checkout' }), 3);
    expect(await screen.findByText('The new checkout')).toBeInTheDocument();
  });

  it('creates a flag off, refuses a blank description in words, and never overwrites one', async () => {
    ready(OFF);
    createMock.mockRejectedValueOnce(new ApiError(409, { status: 409, code: 'FEATURE_FLAG_EXISTS' }));
    renderAs();
    await screen.findByText('checkout-v2', { selector: 'p' });

    const form = screen.getByRole('heading', { name: COPY.addHeading }).closest('section') as HTMLElement;
    await userEvent.type(within(form).getByRole('textbox', { name: new RegExp(COPY.nameLabel) }), 'checkout-v2');
    await userEvent.click(within(form).getByRole('button', { name: COPY.add }));
    expect(within(form).getByText(COPY.descriptionRequired)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();

    await userEvent.type(within(form).getByRole('textbox', { name: new RegExp(COPY.switchesLabel) }), 'Again');
    await userEvent.click(within(form).getByRole('button', { name: COPY.add }));
    expect(createMock).toHaveBeenCalledWith('checkout-v2', 'Again');
    expect(await within(form).findByText(COPY.errors['FEATURE_FLAG_EXISTS']!)).toBeInTheDocument();

    createMock.mockResolvedValueOnce({ ...OFF, key: 'search-v3', description: 'Search', version: 0 });
    const name = within(form).getByRole('textbox', { name: new RegExp(COPY.nameLabel) });
    await userEvent.clear(name);
    await userEvent.type(name, 'search-v3');
    await userEvent.click(within(form).getByRole('button', { name: COPY.add }));

    expect(await within(form).findByText(fillPlaceholders(COPY.created, { flag: 'search-v3' }))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'search-v3' })).toHaveAttribute('aria-checked', 'false');
  });

  it('has no accessibility violations', async () => {
    ready({ ...OFF, enabled: true, rolloutPercentage: 25, enabledAccounts: [AYSEL] });
    const { container } = renderAs();
    await screen.findByText('Aysel Huseynova');

    await expectNoViolations(container);
  });
});
