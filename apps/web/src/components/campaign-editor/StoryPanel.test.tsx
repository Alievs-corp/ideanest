import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import {
  getProjectEdit,
  listStoryVersions,
  patchProject,
  restoreStoryVersion,
  type ProjectEdit,
  type ProjectPatch,
  type StoryVersionSummary,
} from '../../lib/projects/api';
import { measureImage } from '../../lib/projects/coverImage';
import { IMAGE_ALT_REQUIRED, type StoryDocument } from '../../lib/projects/story';
import { StoryPanel } from './StoryPanel';
import { EDITOR_COPY } from '../../test-editor-copy';

/**
 * Appearance is reviewed in Storybook. The document model's own rules are pinned
 * down in `story.test.ts` and autosave's timing in `useAutosave.test.tsx`; these
 * cover what only exists once the pieces are assembled, and what would fail
 * silently.
 *
 * Two of them carry the design. An image block with no description must be HELD
 * rather than sent — the server refuses that document, and autosave retries the
 * same body, so one unfinished description would stop every later save in the
 * session. And every add, move, and remove control must carry a name that says
 * WHICH block it acts on: eleven buttons all called "Move up" are eleven
 * indistinguishable buttons to anybody not looking at the screen.
 */

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  getProjectEdit: vi.fn(),
  patchProject: vi.fn(),
  listStoryVersions: vi.fn(),
  restoreStoryVersion: vi.fn(),
}));

/*
 * `measureImage` is mocked for the reason `BasicsPanel.test.tsx` gives: jsdom never
 * loads an image, so an `<img>` there fires neither `load` nor `error` and the real
 * implementation would hang. What the mock returns is what a browser would report.
 */
vi.mock('../../lib/projects/coverImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/coverImage')>()),
  measureImage: vi.fn(),
}));

const getProjectEditMock = vi.mocked(getProjectEdit);
const patchProjectMock = vi.mocked(patchProject);
const listStoryVersionsMock = vi.mocked(listStoryVersions);
const restoreStoryVersionMock = vi.mocked(restoreStoryVersion);
const measureImageMock = vi.mocked(measureImage);

/** The debounce `useAutosave` defaults to. */
const DEBOUNCE = 800;

const STORY: StoryDocument = {
  version: 1,
  blocks: [
    { type: 'heading', level: 2, id: 'how-it-works', text: 'How it works' },
    { type: 'paragraph', spans: [{ text: 'It records sound.', marks: [] }] },
  ],
};

const PROJECT: ProjectEdit = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'DRAFT',
  title: 'A field recorder',
  story: STORY,
  risks: null,
  latePledgeEnabled: false,
  lockedFields: [],
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

function renderPanel() {
  return render(<StoryPanel projectId="project-1" copy={EDITOR_COPY} />);
}

/** Every patch the panel has sent, oldest first. */
function sent(): ProjectPatch[] {
  return patchProjectMock.mock.calls.map(([, patch]) => patch);
}

/** The debounce, elapsed. */
async function settle(user: UserEvent) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 50);
  });
  // Keeps the pointer/keyboard queue from running ahead of the timers.
  await user.tab();
}

describe('StoryPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getProjectEditMock.mockReset().mockResolvedValue(PROJECT);
    patchProjectMock.mockReset().mockImplementation((_id, patch) =>
      Promise.resolve({ ...PROJECT, ...(patch as Partial<ProjectEdit>) }),
    );
    listStoryVersionsMock.mockReset().mockResolvedValue([]);
    restoreStoryVersionMock.mockReset();
    measureImageMock.mockReset().mockResolvedValue({ width: 1600, height: 900, placeholder: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names every block control by the block it acts on', async () => {
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    /*
     * The position and the block's own text are both in the name, not only in the
     * markup. This is the assertion that would fail if a control were ever given a
     * bare "Move up" — eleven of which are indistinguishable to anybody not
     * looking at the screen.
     */
    expect(
      screen.getByRole('button', { name: 'Move Heading 1 of 2: How it works up' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Move Heading 1 of 2: How it works down' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Heading 1 of 2: How it works' }),
    ).toBeInTheDocument();

    // Nothing icon-only is left nameless anywhere in the editor.
    for (const control of screen.getAllByRole('button')) {
      expect(control).toHaveAccessibleName();
    }
    for (const box of screen.getAllByRole('textbox')) {
      expect(box).toHaveAccessibleName();
    }
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toHaveAccessibleName();
    }
  });

  it('adds, moves and removes a block from the keyboard alone', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    await user.click(screen.getByRole('button', { name: /Add paragraph/ }));
    // Anchored, because each editable block also carries a nested "Formatting
    // for …" group and an unanchored pattern matches both.
    expect(await screen.findByRole('group', { name: /^Paragraph 3 of 3/ })).toBeInTheDocument();

    // Keyboard, not pointer: the editor is built from real form controls
    // precisely so that this works without a bespoke key handler.
    const moveUp = screen.getByRole('button', { name: 'Move Paragraph 3 of 3: empty up' });
    moveUp.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('group', { name: /^Paragraph 2 of 3: empty/ })).toBeInTheDocument();

    const remove = screen.getByRole('button', { name: 'Remove Paragraph 2 of 3: empty' });
    remove.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('group', { name: /of 3/ })).not.toBeInTheDocument();

    // Every structural change is announced, or a screen-reader user has no idea the
    // list they are standing in has just been reordered under them.
    expect(screen.getByText('Paragraph removed. 2 blocks left.')).toBeInTheDocument();
  });

  it('holds an image with no description instead of sending a document the server refuses', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    await user.click(screen.getByRole('button', { name: /Add image/ }));
    await screen.findByRole('group', { name: /^Image 3 of 3/ });
    await user.type(
      screen.getByRole('textbox', { name: /Address of Image 3 of 3/ }),
      'https://images.example.com/prototype.jpg',
    );
    // The address only reaches the block once it has been measured, which is what
    // fills in the width and height the public page reserves space with.
    await user.click(screen.getByRole('button', { name: /Measure and add/ }));
    await settle(user);

    /*
     * Nothing sent, and the reason said out loud. Sending it would earn a
     * STORY_DOCUMENT_INVALID, and because autosave retries the same body that one
     * refusal would block every later save until the page was reloaded.
     */
    expect(sent()).toHaveLength(0);
    expect(screen.getByText(IMAGE_ALT_REQUIRED)).toBeInTheDocument();
    expect(screen.getByText(/story is not being saved yet/i)).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: /Description of Image 3 of 3/ }),
      'The prototype on a desk',
    );
    await settle(user);

    // Valid again, so the WHOLE document goes -- including the address typed
    // before the description, which was never lost.
    const patches = sent();
    expect(patches.length).toBeGreaterThan(0);
    const story = patches.at(-1)?.story;
    expect(story?.blocks.at(-1)).toMatchObject({
      type: 'image',
      url: 'https://images.example.com/prototype.jpg',
      alt: 'The prototype on a desk',
    });
    expect(screen.queryByText(/story is not being saved yet/i)).not.toBeInTheDocument();
  });

  it('previews a measured image in the shape it really is, with the alt as typed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    measureImageMock.mockResolvedValue({
      width: 1600,
      height: 1200,
      placeholder: 'data:image/webp;base64,AAAA',
    });
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    await user.click(screen.getByRole('button', { name: /Add image/ }));
    await screen.findByRole('group', { name: /^Image 3 of 3/ });
    await user.type(
      screen.getByRole('textbox', { name: /Address of Image 3 of 3/ }),
      'https://images.example.com/prototype.jpg',
    );
    await user.click(screen.getByRole('button', { name: /Measure and add/ }));
    await settle(user);

    /*
     * THE INTRINSIC SHAPE, because the public story shows the picture whole and
     * reserves its box from these very numbers — which is the only reason the
     * editor measures at all.
     */
    const frame = document.querySelector<HTMLElement>('[data-media-frame]');
    expect(frame?.style.aspectRatio).toBe('1600 / 1200');

    // The placeholder from the same load, kept out of the accessibility tree.
    const layer = document.querySelector<HTMLElement>('[data-media-placeholder]');
    expect(layer?.style.backgroundImage).toBe('url("data:image/webp;base64,AAAA")');

    /*
     * EMPTY ALT, SHOWN AS EMPTY. The description has not been written yet, and
     * the preview's job is to give the creator what a reader would get rather
     * than something kinder.
     */
    expect(document.querySelector('img')).toHaveAttribute('alt', '');

    await user.type(
      screen.getByRole('textbox', { name: /Description of Image 3 of 3/ }),
      'The prototype on a desk',
    );
    await settle(user);

    expect(document.querySelector('img')).toHaveAttribute('alt', 'The prototype on a desk');
  });

  it('saves the risks section without refusing a half-written answer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();

    const risks = await screen.findByRole('textbox', { name: /Risks and challenges/ });
    await user.type(risks, 'Tooling is the risk.');
    await settle(user);

    /*
     * Well under §5.3's two hundred characters and saved anyway. That minimum is a
     * SUBMISSION requirement (#37 reports it); a field that refused to save a
     * half-written answer would be a field that loses the first half.
     */
    expect(sent()).toContainEqual({ risks: 'Tooling is the risk.' });
  });

  it('lists the anchor menu its headings will generate', async () => {
    renderPanel();

    // §4.6: the headings generate the anchor navigation, and a creator checking it
    // is checking what their project page will show.
    const anchors = await screen.findByRole('region', { name: /Anchor menu/i });
    expect(within(anchors).getByText('How it works')).toBeInTheDocument();
    expect(within(anchors).getByText('#how-it-works')).toBeInTheDocument();
  });

  it('asks before a restore replaces the story', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const version: StoryVersionSummary = {
      number: 3,
      createdAt: '2026-08-14T09:00:00.000Z',
      authorId: 'user-1',
      characters: 1240,
    };
    listStoryVersionsMock.mockResolvedValue([version]);
    renderPanel();
    await screen.findByRole('group', { name: /Heading 1 of 2/ });

    await user.click(screen.getByRole('button', { name: /Earlier versions/ }));
    await user.click(await screen.findByRole('button', { name: /Restore version 3/ }));

    // A restore discards what is on screen. It is recoverable — the current story
    // becomes a version of its own — but it is not something to do on one click.
    expect(await screen.findByRole('dialog', { name: /Restore version 3\?/ })).toBeInTheDocument();
    expect(restoreStoryVersionMock).not.toHaveBeenCalled();
  });
});
