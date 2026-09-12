import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  getProjectEdit,
  listCategories,
  patchProject,
  type Category,
  type ProjectEdit,
  type ProjectPatch,
} from '../../lib/projects/api';
import { measureImage } from '../../lib/projects/coverImage';
import { UploadFailed, uploadImage } from '../../lib/media/upload';
import { BasicsPanel } from './BasicsPanel';
import { BASICS_COPY, EDITOR_COPY } from '../../test-editor-copy';

/**
 * Appearance is reviewed in Storybook. These cover what fails silently: the
 * validation boundaries of docs/architecture.md §5.3, a goal amount that must
 * never become a float, a refusal that has to stay recoverable, and an
 * accessible name on every control.
 *
 * Autosave's own semantics — the debounce, the single request in flight, the
 * merge-back on failure — are pinned down in `useAutosave.test.tsx`, where the
 * timers can be driven exactly. Here the assertions are about WHAT was sent
 * rather than how many requests it took, so a slow machine cannot turn a passing
 * test red by letting a debounce elapse one keystroke early.
 *
 * `measureImage` is mocked because jsdom never loads an image: an `<img>` there
 * fires neither `load` nor `error`, so the real implementation would hang. What
 * the mock returns is what a browser would have reported.
 *
 * `uploadImage` is mocked for the same class of reason: it makes three network calls and
 * polls a fourth. What is asserted here is what the panel does with the answer -- the
 * upload itself belongs to the API, and the conversion behind it is asserted against a
 * real libvips in the backend suite.
 */

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  getProjectEdit: vi.fn(),
  patchProject: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock('../../lib/projects/coverImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/coverImage')>()),
  measureImage: vi.fn(),
}));

vi.mock('../../lib/media/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media/upload')>()),
  uploadImage: vi.fn(),
}));

const getProjectEditMock = vi.mocked(getProjectEdit);
const patchProjectMock = vi.mocked(patchProject);
const listCategoriesMock = vi.mocked(listCategories);
const measureImageMock = vi.mocked(measureImage);
const uploadImageMock = vi.mocked(uploadImage);

/** The debounce `useAutosave` defaults to. */
const DEBOUNCE = 800;

const PROJECT: ProjectEdit = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'DRAFT',
  title: 'A field recorder',
  blurb: 'Pocket-sized and repairable.',
  categoryId: 'category-technology',
  subcategoryId: null,
  goal: { amount: '5000.00', currency: 'AZN' },
  durationDays: 30,
  scheduledLaunchAt: null,
  coverImage: null,
  latePledgeEnabled: false,
  lockedFields: [],
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

const CATEGORIES: readonly Category[] = [
  {
    id: 'category-technology',
    slug: 'technology',
    name: 'Technology',
    subcategories: [{ id: 'sub-hardware', slug: 'hardware', name: 'Hardware' }],
  },
  { id: 'category-music', slug: 'music', name: 'Music', subcategories: [] },
];

/** Lets pending promises settle, and the debounce elapse when asked. */
async function tick(ms = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function openBasics(overrides: Partial<ProjectEdit> = {}): Promise<UserEvent> {
  getProjectEditMock.mockResolvedValue({ ...PROJECT, ...overrides });

  const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
  render(<BasicsPanel projectId="project-1" copy={EDITOR_COPY} basics={BASICS_COPY} />);

  // The project and the category list resolve independently.
  await tick();
  await tick();

  return user;
}

const titleField = (): HTMLElement => screen.getByRole('textbox', { name: 'Title' });
const summaryField = (): HTMLElement => screen.getByRole('textbox', { name: 'Summary' });
const goalField = (): HTMLElement => screen.getByRole('textbox', { name: 'Funding goal' });
const durationField = (): HTMLElement => screen.getByRole('textbox', { name: 'Duration in days' });

function sent(): ProjectPatch[] {
  return patchProjectMock.mock.calls.map(([, patch]) => patch);
}

function lastPatch(): ProjectPatch | undefined {
  return patchProjectMock.mock.lastCall?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  /*
   * `shouldAdvanceTime` lets real time drive the fake clock, and that is what
   * makes `userEvent` usable here at all: its async wrapper waits on a macrotask
   * that a frozen clock never reaches, so every interaction would time out.
   */
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listCategoriesMock.mockResolvedValue(CATEGORIES);
  patchProjectMock.mockImplementation(async () => PROJECT);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Hands a file to the drop zone.
 *
 * `fireEvent` on the input rather than `userEvent.upload`, because the input is `hidden`:
 * the drop zone's own button is what a person clicks, and user-event refuses to interact
 * with an element that is not visible. What is being tested here is what the panel does
 * with a chosen file, and the zone's own click-through is `packages/ui`'s.
 */
function chooseFile(file: File): void {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('The cover field has no file input');
  fireEvent.change(input, { target: { files: [file] } });
}

describe('BasicsPanel', () => {
  it('announces that it is loading rather than showing an empty form', () => {
    getProjectEditMock.mockReturnValue(new Promise<ProjectEdit>(() => {}));
    render(<BasicsPanel projectId="project-1" copy={EDITOR_COPY} basics={BASICS_COPY} />);

    const label = screen.getByText('Loading this campaign');
    expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('gives every control an accessible name', async () => {
    await openBasics();

    expect(titleField()).toBeInTheDocument();
    expect(summaryField()).toBeInTheDocument();
    expect(goalField()).toBeInTheDocument();
    expect(durationField()).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Subcategory' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Currency' })).toBeInTheDocument();
    expect(screen.getByLabelText('Scheduled launch')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Accept late pledges' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Cover image address' })).toBeInTheDocument();
    // Every button says what it does, including the two that only differ by it.
    expect(screen.getByRole('button', { name: 'Use this address' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose an image' })).toBeInTheDocument();
  });

  it('fills the form from the project the service returned', async () => {
    await openBasics();

    expect(titleField()).toHaveValue('A field recorder');
    expect(summaryField()).toHaveValue('Pocket-sized and repairable.');
    expect(goalField()).toHaveValue('5000.00');
    expect(durationField()).toHaveValue('30');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('category-technology');
  });

  describe('autosave', () => {
    it('saves what was typed, with no save button anywhere on the page', async () => {
      const user = await openBasics();

      await user.type(titleField(), ' mk2');
      await tick(DEBOUNCE);

      expect(lastPatch()).toEqual({ title: 'A field recorder mk2' });
      expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    });

    it('does not wait for the pause once the field has lost focus', async () => {
      const user = await openBasics();

      await user.type(titleField(), '!');
      patchProjectMock.mockClear();
      await user.tab();

      // Leaving a field is a stronger signal than a pause in typing, and it is
      // the moment somebody is most likely to close the tab.
      expect(patchProjectMock).toHaveBeenCalledWith('project-1', { title: 'A field recorder!' });
    });

    it('never says "Saved" while something is still on its way', async () => {
      const user = await openBasics();
      patchProjectMock.mockReturnValue(new Promise<ProjectEdit>(() => {}));

      await user.type(titleField(), '!');
      await tick(DEBOUNCE);

      expect(screen.getByText('Saving')).toBeInTheDocument();
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    });

    it('announces the outcome, and only the outcome', async () => {
      const user = await openBasics();

      await user.type(titleField(), '!');
      await tick(DEBOUNCE);

      // "Saving" is deliberately not announced: it is not actionable, and being
      // told it after every pause in typing drowns the message that matters.
      const announcements = screen.getAllByRole('status').map((region) => region.textContent);
      expect(announcements).toContain('Saved');
      expect(announcements).not.toContain('Saving');
    });

    it('does not send anything the field itself has already refused', async () => {
      const user = await openBasics();

      await user.clear(titleField());
      await tick(DEBOUNCE);

      expect(patchProjectMock).not.toHaveBeenCalled();
      expect(screen.getByText('A project needs a title.')).toBeInTheDocument();
    });
  });

  describe('when the service refuses the change', () => {
    it('keeps what was typed, says so, and sends it again on retry', async () => {
      const user = await openBasics();
      patchProjectMock.mockRejectedValue(new ApiError(500, null));

      await user.type(titleField(), '!');
      await tick(DEBOUNCE);

      expect(screen.getAllByText('Not saved').length).toBeGreaterThan(0);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('The change could not be saved.');
      expect(alert).toHaveTextContent('Nothing you typed has been lost');
      // The whole point of the exercise: the text is still in the field.
      expect(titleField()).toHaveValue('A field recorder!');

      patchProjectMock.mockImplementation(async () => PROJECT);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await tick();

      expect(lastPatch()).toEqual({ title: 'A field recorder!' });
      expect(screen.getAllByText('Saved').length).toBeGreaterThan(0);
    });

    it('shows the problem detail from a 409 rather than wording of its own', async () => {
      const user = await openBasics();
      patchProjectMock.mockRejectedValue(
        new ApiError(409, {
          status: 409,
          title: 'Field locked',
          detail: 'The goal cannot change after the campaign has launched.',
          code: 'PROJECT_FIELD_LOCKED',
        }),
      );

      await user.clear(goalField());
      await user.type(goalField(), '6000');
      await tick(DEBOUNCE);

      expect(screen.getByRole('alert')).toHaveTextContent(
        'The goal cannot change after the campaign has launched.',
      );
    });

    it('attaches a 422 field message to the field it is about', async () => {
      const user = await openBasics();
      patchProjectMock.mockRejectedValue(
        new ApiError(422, {
          status: 422,
          detail: 'The change was rejected.',
          errors: { title: 'That title is already used by another of your projects.' },
        }),
      );

      await user.type(titleField(), '!');
      await tick(DEBOUNCE);

      const described = titleField().getAttribute('aria-describedby') ?? '';
      const messages = described
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');

      expect(messages).toContain('already used by another of your projects');
      expect(titleField()).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('the boundaries of §5.3', () => {
    it('accepts a 60-character title and refuses the sixty-first', async () => {
      const user = await openBasics({ title: 'a'.repeat(59) });

      await user.type(titleField(), 'b');
      await tick(DEBOUNCE);
      expect(lastPatch()).toEqual({ title: `${'a'.repeat(59)}b` });

      await user.type(titleField(), 'c');
      await tick(DEBOUNCE);

      expect(screen.getByText('A title is 60 characters or fewer. Remove 1.')).toBeInTheDocument();
      // The 61-character title never reached the service.
      expect(sent()).not.toContainEqual({ title: `${'a'.repeat(59)}bc` });
    });

    it('accepts a 135-character summary and refuses the hundred-and-thirty-sixth', async () => {
      const user = await openBasics({ blurb: 'a'.repeat(134) });

      await user.type(summaryField(), 'b');
      await tick(DEBOUNCE);
      expect(lastPatch()).toEqual({ blurb: `${'a'.repeat(134)}b` });

      await user.type(summaryField(), 'c');
      await tick(DEBOUNCE);

      expect(
        screen.getByText('A summary is 135 characters or fewer. Remove 1.'),
      ).toBeInTheDocument();
      expect(sent()).not.toContainEqual({ blurb: `${'a'.repeat(134)}bc` });
    });

    it('counts what is left, without a cap that swallows a paste', async () => {
      await openBasics({ title: 'a'.repeat(45) });

      // No `maxLength`: "3 characters too many" is actionable, silently losing
      // three letters is not.
      expect(titleField()).not.toHaveAttribute('maxLength');
      expect(screen.getByText('15 characters remaining')).toBeInTheDocument();
    });

    it.each(['0', '61'])('refuses a duration of %s days', async (days) => {
      const user = await openBasics();

      await user.clear(durationField());
      await user.type(durationField(), days);
      await tick(DEBOUNCE);

      expect(screen.getByText('A campaign runs for 1 to 60 days.')).toBeInTheDocument();
      expect(sent()).not.toContainEqual({ durationDays: Number(days) });
    });

    it.each(['1', '60'])('accepts a duration of %s days', async (days) => {
      const user = await openBasics();

      await user.clear(durationField());
      await user.type(durationField(), days);
      await tick(DEBOUNCE);

      expect(lastPatch()).toEqual({ durationDays: Number(days) });
    });

    it('refuses a scheduled launch that has already passed', async () => {
      const user = await openBasics();

      await user.type(screen.getByLabelText('Scheduled launch'), '2020-01-01T10:00');
      await tick(DEBOUNCE);

      expect(screen.getByText('Choose a date and time in the future.')).toBeInTheDocument();
    });
  });

  describe('the goal', () => {
    it('sends the amount as a string, with every digit intact', async () => {
      const user = await openBasics();

      await user.clear(goalField());
      await user.type(goalField(), '1234567890.12');
      await tick(DEBOUNCE);

      expect(lastPatch()).toEqual({ goal: { amount: '1234567890.12', currency: 'AZN' } });
      // A JSON number could not hold this value exactly, which is the whole
      // reason it is never one.
      expect(typeof lastPatch()?.goal?.amount).toBe('string');
    });

    it('normalises the scale rather than sending what was typed verbatim', async () => {
      const user = await openBasics();

      await user.clear(goalField());
      await user.type(goalField(), '7500');
      await tick(DEBOUNCE);

      expect(lastPatch()).toEqual({ goal: { amount: '7500.00', currency: 'AZN' } });
    });

    it('explains a comma instead of saving a hundredth of what was meant', async () => {
      const user = await openBasics();

      await user.clear(goalField());
      await user.click(goalField());
      // Pasted rather than typed, so there is no intermediate "5" for autosave
      // to legitimately save on its way to the comma.
      patchProjectMock.mockClear();
      await user.paste('5,000');
      await tick(DEBOUNCE);

      expect(
        screen.getByText('Use a full stop for the decimal point, for example 5000.00.'),
      ).toBeInTheDocument();
      // Emptying the field is a legitimate "clear the goal"; what must never
      // travel is an amount read out of the comma.
      expect(sent().filter((patch) => patch.goal != null)).toEqual([]);
    });

    it('is disabled when the service says the field is locked', async () => {
      await openBasics({ lockedFields: ['goal', 'durationDays'] });

      expect(goalField()).toBeDisabled();
      expect(durationField()).toBeDisabled();
      expect(
        screen.getByText('The goal cannot change once the campaign has launched.'),
      ).toBeInTheDocument();
    });
  });

  describe('the cover image', () => {
    /*
     * This used to assert the opposite: a banner reading "Uploading arrives with the media
     * pipeline". It has arrived, and the control that told creators to go and host the file
     * somewhere else first is what this change exists to remove.
     */
    it('offers to upload rather than explaining that it cannot', async () => {
      await openBasics();

      expect(
        screen.queryByText('Uploading arrives with the media pipeline'),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Choose an image' })).toBeInTheDocument();
    });

    it('reads the size of an address and saves the two together', async () => {
      const user = await openBasics();
      measureImageMock.mockResolvedValue({ width: 1600, height: 900, placeholder: null });

      await user.type(
        screen.getByRole('textbox', { name: 'Cover image address' }),
        'https://cdn.example.test/cover.jpg',
      );
      await user.click(screen.getByRole('button', { name: 'Use this address' }));
      await tick();
      await tick(DEBOUNCE);

      expect(lastPatch()).toEqual({
        coverImage: {
          url: 'https://cdn.example.test/cover.jpg',
          width: 1600,
          height: 900,
          // Explicitly null rather than absent: this cover did not come from an upload, and
          // a stale identifier left beside a new address is what the server refuses.
          mediaId: null,
        },
      });
      expect(screen.getByText('Cover set from a 1600×900 pixel image.')).toBeInTheDocument();
    });

    /*
     * THE CHANGE, IN ONE TEST. An 800x450 photograph used to be refused outright and never
     * reached the service, which is where a creator holding one got stuck. It is saved now,
     * and what it earns is a note.
     */
    it('saves one below 1024×576 and says it will look soft', async () => {
      const user = await openBasics();
      measureImageMock.mockResolvedValue({ width: 800, height: 450, placeholder: null });

      await user.type(
        screen.getByRole('textbox', { name: 'Cover image address' }),
        'https://cdn.example.test/small.jpg',
      );
      await user.click(screen.getByRole('button', { name: 'Use this address' }));
      await tick();
      await tick(DEBOUNCE);

      expect(lastPatch()).toEqual({
        coverImage: {
          url: 'https://cdn.example.test/small.jpg',
          width: 800,
          height: 450,
          mediaId: null,
        },
      });
      // Said, and deliberately not as an alert: the campaign can still be submitted, so
      // interrupting a screen-reader user for it would misreport what it is.
      expect(screen.getByText(/below the recommended 1024×576/)).toBeInTheDocument();
      // SOFT, NOT STRETCHED. Every surface renders a cover with `object-cover`, so the
      // proportions are kept and the frame crops. Telling a creator their photograph will
      // be squashed would send them to fix a problem they do not have.
      expect(screen.getByText(/proportions are kept/)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('uploads a dropped file and saves the identifier the service gave back', async () => {
      await openBasics();
      uploadImageMock.mockResolvedValue({
        mediaId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        url: 'https://cdn.example.test/media/3f2504e0.jpg',
        width: 1440,
        height: 810,
        blurDataUrl: 'data:image/jpeg;base64,BBBB',
      });

      chooseFile(new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));
      await tick();
      await tick(DEBOUNCE);

      expect(lastPatch()).toEqual({
        coverImage: {
          url: 'https://cdn.example.test/media/3f2504e0.jpg',
          width: 1440,
          height: 810,
          mediaId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        },
      });
      // The dimensions are the server's measurement, which is the whole point of the
      // pipeline: this browser never reported them.
      expect(measureImageMock).not.toHaveBeenCalled();
    });

    it('explains a refusal in words rather than passing the code through', async () => {
      await openBasics();
      uploadImageMock.mockRejectedValue(new UploadFailed('UNSUPPORTED_FORMAT', 'refused'));

      chooseFile(new File(['%PDF-1.7'], 'invoice.jpg', { type: 'image/jpeg' }));
      await tick();

      expect(screen.getByRole('alert')).toHaveTextContent(/not an image this platform can read/);
      expect(sent().filter((patch) => patch.coverImage != null)).toEqual([]);
    });

    it('previews the crop the discovery card will make, with the box reserved', async () => {
      const user = await openBasics();
      measureImageMock.mockResolvedValue({ width: 1600, height: 1200, placeholder: null });

      await user.type(
        screen.getByRole('textbox', { name: 'Cover image address' }),
        'https://cdn.example.test/tall.jpg',
      );
      await user.click(screen.getByRole('button', { name: 'Use this address' }));
      await tick();

      /*
       * 16:9 EVEN THOUGH THE PHOTOGRAPH IS 4:3. The card crops (docs/ui-kit.md
       * §8.2), and a creator about to lose the top and bottom of their picture
       * should find that out here rather than after launch.
       */
      const frame = document.querySelector<HTMLElement>('[data-media-frame]');
      expect(frame?.style.aspectRatio).toBe('16 / 9');
      // Decorative: the caption beside it says the same thing in words.
      expect(document.querySelector('img')).toHaveAttribute('alt', '');
    });

    it('paints the placeholder the same load produced', async () => {
      const user = await openBasics();
      measureImageMock.mockResolvedValue({
        width: 1600,
        height: 900,
        placeholder: 'data:image/webp;base64,AAAA',
      });

      await user.type(
        screen.getByRole('textbox', { name: 'Cover image address' }),
        'https://cdn.example.test/cover.jpg',
      );
      await user.click(screen.getByRole('button', { name: 'Use this address' }));
      await tick();

      const layer = document.querySelector<HTMLElement>('[data-media-placeholder]');
      expect(layer?.style.backgroundImage).toBe('url("data:image/webp;base64,AAAA")');
      // It is a picture, not information: it must not reach a screen reader.
      expect(layer).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('the category list', () => {
    it('keeps the rest of the form working when the endpoint is not there yet', async () => {
      listCategoriesMock.mockRejectedValue(new ApiError(404, null));
      const user = await openBasics();

      expect(screen.getByText('The category list is unavailable')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Category' })).toBeDisabled();

      // The reason for degrading rather than blocking: a title still saves.
      await user.type(titleField(), '!');
      await tick(DEBOUNCE);
      expect(lastPatch()).toEqual({ title: 'A field recorder!' });
    });

    it('sends the subcategory with the category, so nothing is orphaned', async () => {
      const user = await openBasics({ subcategoryId: 'sub-hardware' });

      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Category' }),
        'category-music',
      );
      await tick(DEBOUNCE);

      expect(lastPatch()).toEqual({ categoryId: 'category-music', subcategoryId: null });
    });
  });

  it('turns late pledges on through a switch, which announces on and off', async () => {
    const user = await openBasics();

    const toggle = screen.getByRole('switch', { name: 'Accept late pledges' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);
    await tick(DEBOUNCE);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(lastPatch()).toEqual({ latePledgeEnabled: true });
  });

  describe('when the project cannot be loaded', () => {
    it('says the session has ended rather than showing an empty form', async () => {
      getProjectEditMock.mockRejectedValue(new ApiError(401, null));
      render(<BasicsPanel projectId="project-1" copy={EDITOR_COPY} basics={BASICS_COPY} />);
      await tick();

      expect(screen.getByText('You are signed out')).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
    });

    it('offers a retry when the request simply failed', async () => {
      getProjectEditMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
      render(<BasicsPanel projectId="project-1" copy={EDITOR_COPY} basics={BASICS_COPY} />);
      await tick();

      expect(screen.getByRole('alert')).toHaveTextContent('The service could not be reached.');

      getProjectEditMock.mockResolvedValueOnce(PROJECT);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await tick();

      expect(titleField()).toHaveValue('A field recorder');
    });
  });
});
