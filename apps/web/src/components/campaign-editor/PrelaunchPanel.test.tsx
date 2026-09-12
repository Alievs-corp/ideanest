import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import {
  getPrelaunchPage,
  getProjectEdit,
  openPrelaunch,
  patchProject,
  type PrelaunchPage,
  type ProjectEdit,
} from '../../lib/projects/api';
import { PrelaunchPanel } from './PrelaunchPanel';
import { EDITOR_COPY } from '../../test-editor-copy';

/**
 * The creator's pre-launch tab.
 *
 * The test that carries the design is
 * {@link openingIsBehindAConfirmation}: opening the page publishes the campaign
 * and docs/architecture.md §6.1 has no edge back, so a control that did it on a
 * single click would be the worst control on the platform. The rest cover the
 * two things a creator comes to this tab for — the link and the number — and the
 * fact that the content editor writes through the ordinary autosave path rather
 * than inventing a second one.
 *
 * `navigator.clipboard` is stubbed because jsdom has none; what the stub records
 * is what the browser would have been handed.
 */

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  getProjectEdit: vi.fn(),
  getPrelaunchPage: vi.fn(),
  openPrelaunch: vi.fn(),
  patchProject: vi.fn(),
}));

const getProjectEditMock = vi.mocked(getProjectEdit);
const getPrelaunchPageMock = vi.mocked(getPrelaunchPage);
const openPrelaunchMock = vi.mocked(openPrelaunch);
const patchProjectMock = vi.mocked(patchProject);

/** The debounce `useAutosave` defaults to. */
const DEBOUNCE = 800;

const PROJECT: ProjectEdit = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'DRAFT',
  title: 'A field recorder',
  blurb: 'Pocket-sized and repairable.',
  categoryId: null,
  subcategoryId: null,
  goal: null,
  durationDays: null,
  scheduledLaunchAt: null,
  coverImage: null,
  latePledgeEnabled: false,
  lockedFields: [],
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

const PAGE: PrelaunchPage = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'PRELAUNCH',
  title: 'A field recorder',
  blurb: 'Pocket-sized and repairable.',
  coverImage: null,
  scheduledLaunchAt: null,
  followerCount: 41,
};

async function tick(ms = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function openPanel(overrides: Partial<ProjectEdit> = {}): Promise<UserEvent> {
  getProjectEditMock.mockResolvedValue({ ...PROJECT, ...overrides });

  const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
  render(<PrelaunchPanel projectId="project-1" copy={EDITOR_COPY} />);

  // The project and, when the page is open, the follower count resolve
  // independently.
  await tick();
  await tick();

  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getPrelaunchPageMock.mockResolvedValue(PAGE);
  patchProjectMock.mockImplementation(async () => PROJECT);
  openPrelaunchMock.mockImplementation(async () => ({ ...PROJECT, state: 'PRELAUNCH' }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PrelaunchPanel', () => {
  it('says the page is not open yet, and does not show a link to nowhere', async () => {
    await openPanel();

    expect(screen.getByRole('heading', { name: 'The pre-launch page is not open yet' })).toBeInTheDocument();
    // A link that 404s is worse than no link. Nothing to share until there is
    // something at the other end.
    expect(screen.queryByRole('textbox', { name: 'Pre-launch link' })).not.toBeInTheDocument();
    // And nothing is read from the public endpoint for a campaign that has no
    // public page.
    expect(getPrelaunchPageMock).not.toHaveBeenCalled();
  });

  it('opens the page only after the creator confirms, and says what cannot be undone', async () => {
    const user = await openPanel();

    await user.click(screen.getByRole('button', { name: 'Open the pre-launch page' }));

    // The dialog, not a toast and not an inline "are you sure": this publishes
    // the campaign and §6.1 has no PRELAUNCH -> DRAFT edge.
    const dialog = screen.getByRole('dialog', { name: 'Open the pre-launch page?' });
    expect(dialog).toHaveAccessibleDescription(/cannot be undone/);
    expect(openPrelaunchMock).not.toHaveBeenCalled();

    // Cancelling does nothing at all.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(openPrelaunchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open the pre-launch page' }));
    await user.click(screen.getByRole('button', { name: 'Open the page' }));
    await tick();

    expect(openPrelaunchMock).toHaveBeenCalledWith('project-1');
  });

  it('shows the link and the number of people waiting once the page is open', async () => {
    await openPanel({ state: 'PRELAUNCH' });

    const link = screen.getByRole('textbox', { name: 'Pre-launch link' });
    // Read-only rather than disabled: a disabled input cannot be focused or
    // selected, and selecting the address by hand is the fallback when the
    // clipboard is refused.
    expect(link).toHaveAttribute('readonly');
    expect(link).toHaveValue('http://localhost:3000/projects/project-1/prelaunch');

    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText(/people are waiting for this campaign/)).toBeInTheDocument();
  });

  it('copies the link and says so, rather than only changing an icon', async () => {
    const user = await openPanel({ state: 'PRELAUNCH' });

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await tick();

    // `userEvent.setup()` installs its own clipboard stub, so this reads back
    // what the browser would have been handed rather than what a spy of ours
    // recorded.
    await expect(navigator.clipboard.readText()).resolves.toBe(
      'http://localhost:3000/projects/project-1/prelaunch',
    );
    // A keyboard user who cannot see the icon change is told what happened. There
    // is more than one live region on this surface — the autosave indicator has
    // its own — so this looks for the one that carries the message.
    expect(
      screen.getAllByRole('status').map((region) => region.textContent),
    ).toContain('Link copied');
  });

  it('says the number is unavailable rather than pretending it is zero', async () => {
    getPrelaunchPageMock.mockRejectedValue(new Error('offline'));

    await openPanel({ state: 'PRELAUNCH' });

    // Telling a creator that nobody has signed up, when the request simply
    // failed, is worse than telling them nothing.
    expect(screen.getByText('The number of people waiting could not be loaded.')).toBeInTheDocument();
  });

  it('edits the page content through the ordinary autosave path', async () => {
    const user = await openPanel({ state: 'PRELAUNCH' });

    await user.clear(screen.getByRole('textbox', { name: 'Summary' }));
    await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Now with two microphones.');
    await tick(DEBOUNCE);

    // The same PATCH the Basics tab uses, and the same field. A dedicated
    // pre-launch summary would let the page promise something the campaign does
    // not.
    expect(patchProjectMock).toHaveBeenLastCalledWith('project-1', {
      blurb: 'Now with two microphones.',
    });
  });

  it('says the page has closed once the campaign has moved past it', async () => {
    await openPanel({ state: 'LIVE' });

    expect(screen.getByText(/The pre-launch page has closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the pre-launch page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Pre-launch link' })).not.toBeInTheDocument();
  });

  it('gives every control an accessible name', async () => {
    await openPanel({ state: 'PRELAUNCH' });

    for (const control of [
      ...screen.getAllByRole('textbox'),
      ...screen.getAllByRole('button'),
    ]) {
      expect(control).toHaveAccessibleName();
    }
  });
});
