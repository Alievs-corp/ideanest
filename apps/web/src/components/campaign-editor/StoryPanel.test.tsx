import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
import { UploadFailed, uploadImage, type UploadedImage } from '../../lib/media/upload';
import type { StoryDocument } from '@ideanest/campaign-editor/story';
import { StoryPanel } from './StoryPanel';
import { EDITOR_COPY, STORY_COPY } from '../../test-editor-copy';

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

/*
 * The upload is mocked for the reason `BasicsPanel.test.tsx` gives for the cover: three
 * requests and a poll that belong to `lib/media/upload.ts`. What an image block does with the
 * result — and with a refusal — is what is asserted here (#313).
 */
vi.mock('../../lib/media/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media/upload')>()),
  uploadImage: vi.fn(),
}));

const getProjectEditMock = vi.mocked(getProjectEdit);
const patchProjectMock = vi.mocked(patchProject);
const listStoryVersionsMock = vi.mocked(listStoryVersions);
const restoreStoryVersionMock = vi.mocked(restoreStoryVersion);
const measureImageMock = vi.mocked(measureImage);
const uploadImageMock = vi.mocked(uploadImage);

const UPLOADED: UploadedImage = {
  mediaId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  url: 'https://cdn.example.test/media/3f2504e0.jpg',
  width: 1440,
  height: 1080,
  blurDataUrl: 'data:image/jpeg;base64,BBBB',
};

/**
 * Hands a file to one image block's drop zone, found by the name it carries. `fireEvent` on the
 * input rather than `userEvent.upload`, because the input is hidden behind the zone's button.
 */
function chooseFileFor(name: RegExp, file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' })) {
  const input = screen.getByRole('group', { name }).querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error(`${name} has no file input`);
  fireEvent.change(input, { target: { files: [file] } });
}

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
  lockedFields: [],
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

function renderPanel() {
  return render(<StoryPanel projectId="project-1" copy={EDITOR_COPY} story={STORY_COPY} />);
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
    uploadImageMock.mockReset();
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

  it('sends an image with no description, and warns about it on the block without holding the save', async () => {
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
     * Sent, with the description empty (#543): holding it once cost a creator every
     * image in the story. The block says what is missing, and the description field
     * is described by it, but nothing waits for it.
     */
    expect(sent().at(-1)?.story?.blocks.at(-1)).toMatchObject({
      type: 'image',
      url: 'https://images.example.com/prototype.jpg',
      alt: '',
    });
    const warning = screen.getByText(STORY_COPY.vocabulary.warnings.imageNeedsAlt);
    expect(screen.getByRole('textbox', { name: /Description of Image 3 of 3/ })).toHaveAttribute(
      'aria-describedby',
      warning.id,
    );
    expect(screen.queryByText(/story is not being saved yet/i)).not.toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: /Description of Image 3 of 3/ }),
      'The prototype on a desk',
    );
    await settle(user);

    expect(sent().at(-1)?.story?.blocks.at(-1)).toMatchObject({
      type: 'image',
      url: 'https://images.example.com/prototype.jpg',
      alt: 'The prototype on a desk',
    });
    expect(screen.queryByText(STORY_COPY.vocabulary.warnings.imageNeedsAlt)).not.toBeInTheDocument();
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

  /*
   * #313. The block used to say, in a banner, that nothing was uploaded here. The upload's
   * result is exactly what an image block stores, so the block takes it as it is.
   */
  it('uploads a chosen file into the block, keeping a description typed while it uploaded', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let finish: ((image: UploadedImage) => void) | undefined;
    uploadImageMock.mockImplementation((_file, options) => {
      options?.onStage?.('uploading');
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    await user.click(screen.getByRole('button', { name: /Add image/ }));
    await screen.findByRole('group', { name: /^Image 3 of 3/ });
    expect(screen.queryByText('Nothing is uploaded here')).not.toBeInTheDocument();

    chooseFileFor(/^Upload to Image 3 of 3/);
    expect(await screen.findByText('Uploading the image…')).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: /Description of Image 3 of 3/ }),
      'The prototype on a desk',
    );
    await act(async () => finish?.(UPLOADED));
    await settle(user);

    // The service's measurement, not this browser's: nothing was measured here.
    expect(measureImageMock).not.toHaveBeenCalled();
    expect(sent().at(-1)?.story?.blocks.at(-1)).toEqual({
      type: 'image',
      url: UPLOADED.url,
      width: 1440,
      height: 1080,
      alt: 'The prototype on a desk',
    });
    expect(screen.getByText('Added a 1440×1080 pixel image.')).toBeInTheDocument();
    // The address box shows where the picture now lives, so it can be read and replaced.
    expect(screen.getByRole('textbox', { name: /Address of Image 3 of 3/ })).toHaveValue(UPLOADED.url);
  });

  it.each([
    ['UNSUPPORTED_FORMAT', /not an image this platform can read/],
    ['TOO_LARGE', /The limit is 20 MB/],
    ['TOO_SMALL', /from 320×320 upwards/],
    ['EMPTY', /That file is empty/],
    ['UPLOADS_UNAVAILABLE', /not switched on for this environment/],
  ])('explains an upload refused with %s, and leaves the block as it was', async (code, sentence) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    uploadImageMock.mockRejectedValue(new UploadFailed(code, 'service log sentence'));
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    await user.click(screen.getByRole('button', { name: /Add image/ }));
    await screen.findByRole('group', { name: /^Image 3 of 3/ });
    chooseFileFor(/^Upload to Image 3 of 3/);

    // Not the only alert: an empty image block already has one saying the story is held.
    const alert = (await screen.findByText('That file was not used')).closest('[role="alert"]');
    expect(alert).toHaveTextContent(sentence);
    expect(alert).not.toHaveTextContent('service log sentence');
    await settle(user);
    expect(sent().some((patch) => JSON.stringify(patch).includes('cdn.example.test'))).toBe(false);
  });

  it('adds a section: a title its anchor follows, an uploaded picture with a description, and text', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    uploadImageMock.mockImplementation(() => Promise.resolve(UPLOADED));
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    await user.click(screen.getByRole('button', { name: /Add section/ }));
    await screen.findByRole('group', { name: /^Section 3 of 3/ });
    await user.type(await screen.findByRole('textbox', { name: /Title of Section 3 of 3/ }), 'Our workshop');

    chooseFileFor(/^Add an image to Section 3 of 3/);
    expect(await screen.findByText('Added a 1440×1080 pixel image.')).toBeInTheDocument();
    // Warned about until the picture is described, as an image block is — never held.
    expect(screen.getByText(STORY_COPY.vocabulary.warnings.imageNeedsAlt)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /Description of Section 3 of 3/ }), 'The bench');
    await user.type(screen.getByRole('textbox', { name: /Text of Section 3 of 3/ }), 'Where it is made.');
    await settle(user);

    expect(sent().at(-1)?.story?.blocks.at(-1)).toEqual({
      type: 'section',
      id: 'our-workshop',
      title: 'Our workshop',
      image: { url: UPLOADED.url, width: 1440, height: 1080, alt: 'The bench' },
      video: null,
      spans: [{ text: 'Where it is made.', marks: [] }],
    });

    // Listed in the anchor menu like a heading, because the page lists it.
    const anchors = screen.getByRole('region', { name: /Anchor menu/i });
    expect(within(anchors).getByText('Our workshop')).toBeInTheDocument();
    expect(within(anchors).getByText('#our-workshop')).toBeInTheDocument();

    // The picture can be replaced and taken down, and the controls say which section's.
    expect(screen.getByRole('group', { name: /^Replace the image of Section 3 of 3/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Remove the image from Section 3 of 3/ }));
    await settle(user);
    expect(sent().at(-1)?.story?.blocks.at(-1)).toMatchObject({ type: 'section', image: null });
  });

  it('gives a section an anchor no heading is using', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    await user.click(screen.getByRole('button', { name: /Add section/ }));
    await user.type(await screen.findByRole('textbox', { name: /Title of Section 3 of 3/ }), 'How it works');
    await settle(user);

    // The heading above already holds `how-it-works`; both are fragments of one URL.
    expect(sent().at(-1)?.story?.blocks.at(-1)).toMatchObject({ type: 'section', id: 'how-it-works-2' });
  });

  it('opens a story that has none on an empty paragraph to type into, and sends nothing for it', async () => {
    getProjectEditMock.mockResolvedValue({ ...PROJECT, story: null });
    renderPanel();

    // Without it the creator has to know that writing starts with "Add paragraph".
    const paragraph = await screen.findByRole('group', { name: /^Paragraph 1 of 1/ });
    expect(within(paragraph).getByRole('textbox')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE + 50);
    });
    // Opening the tab is not an edit.
    expect(sent()).toEqual([]);
  });

  it('says under the story and the risks how much they still lack, once the creator has left them', async () => {
    getProjectEditMock.mockResolvedValue({ ...PROJECT, story: null, risks: null });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();

    const paragraph = await screen.findByRole('group', { name: /^Paragraph 1 of 1/ });
    const storyShort = /^The story needs at least 500 characters before you can submit\./;
    const risksShort = /^Risks and challenges need at least 200 characters before you can submit\./;

    // Nothing on a fresh draft: unwritten is not wrong.
    expect(screen.queryByText(storyShort)).not.toBeInTheDocument();
    expect(screen.queryByText(risksShort)).not.toBeInTheDocument();

    await user.type(within(paragraph).getByRole('textbox'), 'Short.');
    // Still writing: moving between the editor's own controls is not leaving it.
    await user.click(screen.getByRole('button', { name: /Add heading/ }));
    expect(screen.queryByText(storyShort)).not.toBeInTheDocument();

    const risks = screen.getByRole('textbox', { name: /Risks and challenges/ });
    await user.click(risks);
    expect(screen.getByText(storyShort)).toHaveTextContent('Add 494 more.');

    await user.type(risks, 'Tooling.');
    await user.tab();
    expect(screen.getByText(risksShort)).toHaveTextContent('Add 192 more.');
    // On the field, not only near it: the textarea is described by it.
    expect(risks).toHaveAccessibleDescription(expect.stringContaining('Add 192 more.'));
  });

  it('says at once when a story written earlier is still short', async () => {
    renderPanel();
    await screen.findByRole('group', { name: /^Heading 1 of 2/ });

    expect(
      screen.getByText(/^The story needs at least 500 characters before you can submit\./),
    ).toBeInTheDocument();
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
