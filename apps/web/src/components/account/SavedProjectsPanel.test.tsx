import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { listSaved, unsaveCampaign, type SavedCampaign } from '../../lib/community/signals';
import { SavedProjectsPanel } from './SavedProjectsPanel';
import { savedListCopyFrom } from '../../lib/i18n/signals-copy';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #83.
 *
 * Retyping them here would give a test that passes whatever the catalogue says, and would
 * still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = savedListCopyFrom(translatorFor('account.signals'), translatorFor('common'));

/**
 * §4.9's C-10 — issue #288.
 *
 * WHAT THESE COVER:
 *
 *   - **each Remove button has its own accessible name.** A list of eight buttons all called
 *     "Remove" is a list a screen reader cannot tell apart (docs/ui-kit.md §9.4), and this is
 *     the check that keeps the title in the name.
 *   - **an optimistic removal reverts.** The row goes at once because the reader is looking at
 *     the button they pressed, and comes back with a message when the service refused — a row
 *     that stayed missing would be a list disagreeing with the server until the next reload.
 *   - the empty state offers the way out rather than an apology.
 *   - a second page is appended rather than replacing what is already read.
 */

vi.mock('../../lib/community/signals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/community/signals')>()),
  listSaved: vi.fn(),
  unsaveCampaign: vi.fn(),
}));

const listMock = vi.mocked(listSaved);
const unsaveMock = vi.mocked(unsaveCampaign);

function campaign(id: string, title: string): SavedCampaign {
  return {
    projectId: id,
    title,
    creatorSlug: 'aysel',
    projectSlug: `slug-${id}`,
    savedAt: '2026-08-20T09:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  unsaveMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('SavedProjectsPanel', () => {
  it('announces the wait rather than showing a blank panel', () => {
    listMock.mockReturnValue(new Promise(() => {}));
    render(<SavedProjectsPanel copy={COPY} />);

    const label = screen.getByText('Loading your saved campaigns');
    expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('links each row at §10.2’s canonical campaign path', async () => {
    listMock.mockResolvedValue({ items: [campaign('p1', 'A tabletop game')], nextCursor: null });
    render(<SavedProjectsPanel copy={COPY} />);

    expect(await screen.findByRole('link', { name: 'A tabletop game' })).toHaveAttribute('href', '/en/projects/aysel/slug-p1');
  });

  it('names every Remove button after the campaign it removes', async () => {
    listMock.mockResolvedValue({
      items: [campaign('p1', 'A tabletop game'), campaign('p2', 'A photo book')],
      nextCursor: null,
    });
    render(<SavedProjectsPanel copy={COPY} />);

    expect(
      await screen.findByRole('button', {
        name: 'Remove A tabletop game from your saved campaigns',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove A photo book from your saved campaigns' }),
    ).toBeInTheDocument();
  });

  it('takes the row away at once', async () => {
    listMock.mockResolvedValue({ items: [campaign('p1', 'A tabletop game')], nextCursor: null });
    const user = userEvent.setup();
    render(<SavedProjectsPanel copy={COPY} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove A tabletop game from your saved campaigns',
      }),
    );

    await waitFor(() => expect(unsaveMock).toHaveBeenCalledWith('p1'));
    expect(screen.queryByRole('link', { name: 'A tabletop game' })).not.toBeInTheDocument();
  });

  it('puts the row back and says so when the service refused', async () => {
    listMock.mockResolvedValue({ items: [campaign('p1', 'A tabletop game')], nextCursor: null });
    unsaveMock.mockRejectedValue(new ApiError(500));
    const user = userEvent.setup();
    render(<SavedProjectsPanel copy={COPY} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove A tabletop game from your saved campaigns',
      }),
    );

    expect(await screen.findByText('That was not removed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'A tabletop game' })).toBeInTheDocument();
  });

  it('appends the next page rather than replacing what is already read', async () => {
    listMock
      .mockResolvedValueOnce({ items: [campaign('p1', 'First')], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [campaign('p2', 'Second')], nextCursor: null });
    const user = userEvent.setup();
    render(<SavedProjectsPanel copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: 'Show more' }));

    expect(await screen.findByRole('link', { name: 'Second' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First' })).toBeInTheDocument();
    // The signal is `undefined` on a page load: only the first read is abortable, because
    // only the first is tied to the component's own mount.
    expect(listMock).toHaveBeenLastCalledWith('cursor-2', undefined);
  });

  it('offers somewhere to go when nothing is saved', async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });
    render(<SavedProjectsPanel copy={COPY} />);

    expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse campaigns/u })).toHaveAttribute('href', '/en/discover');
  });

  it('renders nothing at all when there is no session, rather than an error', async () => {
    listMock.mockRejectedValue(new ApiError(401));
    const { container } = render(<SavedProjectsPanel copy={COPY} />);

    // `SessionProvider`'s guard is what acts on a 401; a panel shouting about it would be a
    // second, louder answer to the same fact.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
