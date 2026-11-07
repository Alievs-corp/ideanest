import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import {
  getPrelaunchPage,
  getProjectEdit,
  patchProject,
  type PrelaunchPage,
  type ProjectEdit,
} from '../../lib/projects/api';
import { PrelaunchPanel } from './PrelaunchPanel';
import { BASICS_COPY, EDITOR_COPY, PRELAUNCH_COPY } from '../../test-editor-copy';

/**
 * The creator's pre-launch tab.
 *
 * The tests that carry the design are the first two: the page is public only
 * once moderation has approved the campaign, so before
 * that there is nothing to open and no link to share. The rest cover the two
 * things a creator comes to this tab for — the link and the number — and the
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
  patchProject: vi.fn(),
}));

const getProjectEditMock = vi.mocked(getProjectEdit);
const getPrelaunchPageMock = vi.mocked(getPrelaunchPage);
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
  lockedFields: [],
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

const PAGE: PrelaunchPage = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'SCHEDULED',
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
  render(
    <PrelaunchPanel
      projectId="project-1"
      copy={EDITOR_COPY}
      validation={BASICS_COPY.validation}
      cover={BASICS_COPY.cover}
      prelaunch={PRELAUNCH_COPY}
    />,
  );

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
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PrelaunchPanel', () => {
  it.each(['DRAFT', 'PRELAUNCH', 'SUBMITTED', 'CHANGES_REQUESTED'] as const)(
    'says the page of a %s campaign opens after approval, and offers nothing to open',
    async (state) => {
      await openPanel({ state });

      expect(screen.getByText('The pre-launch page opens after approval')).toBeInTheDocument();
      // Opening it from a draft published a campaign nobody had reviewed. There is
      // no such control any more, and no link to a page that would 404.
      expect(screen.queryByRole('button', { name: /open the/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Pre-launch link' })).not.toBeInTheDocument();
      // And nothing is read from the public endpoint for a campaign that has no
      // public page.
      expect(getPrelaunchPageMock).not.toHaveBeenCalled();
    },
  );

  it.each(['APPROVED', 'SCHEDULED'] as const)(
    'shows the link and the number of people waiting once the campaign is %s',
    async (state) => {
      await openPanel({ state });

      const link = screen.getByRole('textbox', { name: 'Pre-launch link' });
      // Read-only rather than disabled: a disabled input cannot be focused or
      // selected, and selecting the address by hand is the fallback when the
      // clipboard is refused.
      expect(link).toHaveAttribute('readonly');
      expect(link).toHaveValue('http://localhost:3000/projects/project-1/prelaunch');

      expect(screen.getByText('41')).toBeInTheDocument();
      expect(screen.getByText(/people are waiting for this campaign/)).toBeInTheDocument();
      expect(screen.queryByText('The pre-launch page opens after approval')).not.toBeInTheDocument();
    },
  );

  it('copies the link and says so, rather than only changing an icon', async () => {
    const user = await openPanel({ state: 'SCHEDULED' });

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

    await openPanel({ state: 'SCHEDULED' });

    // Telling a creator that nobody has signed up, when the request simply
    // failed, is worse than telling them nothing.
    expect(screen.getByText('The number of people waiting could not be loaded.')).toBeInTheDocument();
  });

  it('edits the page content through the ordinary autosave path', async () => {
    const user = await openPanel({ state: 'SCHEDULED' });

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
    expect(screen.queryByText('The pre-launch page opens after approval')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Pre-launch link' })).not.toBeInTheDocument();
  });

  it('gives every control an accessible name', async () => {
    await openPanel({ state: 'SCHEDULED' });

    for (const control of [
      ...screen.getAllByRole('textbox'),
      ...screen.getAllByRole('button'),
    ]) {
      expect(control).toHaveAccessibleName();
    }
  });
});
