import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  createFaq,
  deleteFaq,
  getProjectEdit,
  listFaqs,
  patchFaq,
  reorderFaqs,
  type ProjectEdit,
  type ProjectFaq,
} from '../../lib/projects/api';
import { FaqPanel } from './FaqPanel';
import { EDITOR_COPY } from '../../test-editor-copy';

/**
 * §4.4's creator-managed question and answer list — the editor half of #283.
 *
 * Appearance is reviewed in Storybook. These cover what fails silently:
 *
 *   - **reordering is reachable without a pointer, and it sends every identifier exactly
 *     once.** Dragging alone is unreachable by keyboard, by switch control and on every touch
 *     device — the rule docs/ui-kit.md §7.13 states about the drop zone's button — and the
 *     service refuses a partial order outright, because the entries it omitted would stay
 *     where they were and interleave with the ones that moved.
 *   - **the move is announced with its new position.** A creator who cannot see the list is
 *     told nothing at all by a visual reshuffle.
 *   - **focus lands on the control the entry keeps.** An entry moved to an end loses one of
 *     its two buttons, and a control that disables itself under the user's finger drops focus
 *     at the top of the document.
 *   - **a refusal naming missing and unexpected identifiers reaches the creator as
 *     questions.** `FAQ_ORDER_INCOMPLETE` carries UUIDs in `meta`, and a UUID is not something
 *     anybody can act on; the list is also re-read, because the optimistic order on screen is
 *     a lie once the service has refused it.
 *   - **every control says which entry it acts on.** "Delete" six times over is six controls a
 *     screen-reader user cannot tell apart (docs/ui-kit.md §9.1).
 *   - **nothing is saved on a pause in typing.** Creating an entry is a `POST` and a `POST`
 *     cannot be debounced — and this list is public the moment the campaign is, so a
 *     half-typed question is one a backer reads.
 */

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  getProjectEdit: vi.fn(),
  listFaqs: vi.fn(),
  createFaq: vi.fn(),
  patchFaq: vi.fn(),
  deleteFaq: vi.fn(),
  reorderFaqs: vi.fn(),
}));

const getProjectEditMock = vi.mocked(getProjectEdit);
const listFaqsMock = vi.mocked(listFaqs);
const createFaqMock = vi.mocked(createFaq);
const patchFaqMock = vi.mocked(patchFaq);
const deleteFaqMock = vi.mocked(deleteFaq);
const reorderFaqsMock = vi.mocked(reorderFaqs);

const PROJECT: ProjectEdit = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'DRAFT',
  title: 'A field recorder',
  goal: { amount: '5000.00', currency: 'AZN' },
  durationDays: 30,
  latePledgeEnabled: false,
  lockedFields: [],
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

const SHIPPING: ProjectFaq = {
  id: 'faq-a',
  question: 'Do you ship to Germany?',
  answer: 'Yes — shipping is calculated at checkout.',
};

const DELIVERY: ProjectFaq = {
  id: 'faq-b',
  question: 'When does it ship?',
  answer: 'March, if the moulds arrive on time.',
};

/** Lets pending promises settle. */
async function tick(ms = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function openFaqs(faqs: readonly ProjectFaq[] = [SHIPPING, DELIVERY]): Promise<UserEvent> {
  getProjectEditMock.mockResolvedValue(PROJECT);
  listFaqsMock.mockResolvedValue(faqs);

  const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
  render(<FaqPanel projectId="project-1" copy={EDITOR_COPY} />);

  // The project, then the list.
  await tick();
  await tick();

  return user;
}

const faqList = (): HTMLElement =>
  screen.getByRole('list', { name: 'Questions, in the order backers see them' });

beforeEach(() => {
  vi.clearAllMocks();
  /*
   * `shouldAdvanceTime` lets real time drive the fake clock, which is what makes
   * `userEvent` usable at all: its async wrapper waits on a macrotask a frozen
   * clock never reaches.
   */
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FaqPanel', () => {
  it('lists the entries in the service’s order, with a name on every control', async () => {
    await openFaqs();

    const questions = within(faqList())
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(questions).toEqual(['Do you ship to Germany?', 'When does it ship?']);

    expect(
      screen.getByRole('button', { name: 'Edit Do you ship to Germany?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete Do you ship to Germany?' }),
    ).toBeInTheDocument();
  });

  it('tells a creator with no questions what the public tab currently says', async () => {
    await openFaqs([]);

    expect(screen.getByRole('heading', { name: 'No questions yet' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add the first question' }),
    ).toBeInTheDocument();
  });

  it('blames the service when the list could not be read', async () => {
    getProjectEditMock.mockResolvedValue(PROJECT);
    listFaqsMock.mockRejectedValue(new ApiError(500, { status: 500, title: 'Server error' }));

    render(<FaqPanel projectId="project-1" copy={EDITOR_COPY} />);
    await tick();
    await tick();

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded|Server error/u);
  });

  describe('reordering', () => {
    it('is reachable without a pointer, and sends every identifier exactly once', async () => {
      const user = await openFaqs();
      reorderFaqsMock.mockResolvedValue([DELIVERY, SHIPPING]);

      await user.click(
        screen.getByRole('button', { name: 'Move When does it ship? up, currently 2 of 2' }),
      );
      await tick();

      /*
       * Every entry, exactly once. The service refuses a partial order outright,
       * because the entries it omits would stay where they were and interleave
       * with the ones that moved.
       */
      expect(reorderFaqsMock).toHaveBeenCalledWith('project-1', ['faq-b', 'faq-a']);

      const questions = within(faqList())
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent);
      expect(questions).toEqual(['When does it ship?', 'Do you ship to Germany?']);
    });

    it('announces the new position, because the visual reshuffle says nothing', async () => {
      const user = await openFaqs();
      reorderFaqsMock.mockResolvedValue([DELIVERY, SHIPPING]);

      await user.click(
        screen.getByRole('button', { name: 'Move When does it ship? up, currently 2 of 2' }),
      );
      await tick();

      const announcements = screen.getAllByRole('status').map((region) => region.textContent);
      expect(announcements).toContain('When does it ship? moved to position 1 of 2.');
    });

    /*
     * An entry moved to the top loses its "move up", and a control that disables
     * itself under the user's finger drops focus at the top of the document.
     */
    it('hands focus to the control the entry keeps when it reaches an end', async () => {
      const user = await openFaqs();
      reorderFaqsMock.mockResolvedValue([DELIVERY, SHIPPING]);

      await user.click(
        screen.getByRole('button', { name: 'Move When does it ship? up, currently 2 of 2' }),
      );
      await tick();

      expect(document.activeElement).toHaveAccessibleName(
        'Move When does it ship? down, currently 1 of 2',
      );
    });

    /**
     * `FAQ_ORDER_INCOMPLETE` carries the identifiers in `meta.missing` and
     * `meta.unexpected`. A UUID is not something a creator can act on, so each is turned back
     * into the question it belongs to — and the list is re-read, because the optimistic order
     * on screen is a lie the moment the service has refused it.
     */
    it('surfaces a refusal naming missing and unexpected entries, and re-reads the list', async () => {
      const user = await openFaqs();
      reorderFaqsMock.mockRejectedValue(
        new ApiError(400, {
          status: 400,
          detail: 'A reorder lists every question of the campaign exactly once.',
          code: 'FAQ_ORDER_INCOMPLETE',
          meta: { missing: ['faq-a'], unexpected: ['faq-gone'] },
        }),
      );

      await user.click(
        screen.getByRole('button', { name: 'Move When does it ship? up, currently 2 of 2' }),
      );
      await tick();
      await tick();

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(
        'A reorder lists every question of the campaign exactly once.',
      );
      // The one it knows is named; the one it has never seen is counted.
      expect(alert).toHaveTextContent('Do you ship to Germany?');
      expect(alert).toHaveTextContent('1 other question');
      // Nothing prints a raw identifier at a creator.
      expect(alert.textContent).not.toContain('faq-gone');

      expect(listFaqsMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('writing an entry', () => {
    it('creates one from the drawer, and only when Save is pressed', async () => {
      const user = await openFaqs([]);
      createFaqMock.mockResolvedValue({
        id: 'faq-new',
        question: 'Is there a digital edition?',
        answer: 'Not yet.',
      });

      await user.click(screen.getByRole('button', { name: 'Add the first question' }));
      await user.type(
        screen.getByRole('textbox', { name: 'Question' }),
        'Is there a digital edition?',
      );
      await user.type(screen.getByRole('textbox', { name: 'Answer' }), 'Not yet.');

      /*
       * NOTHING HAS BEEN SENT. Creating an entry is a `POST`, and a `POST` fired on a pause
       * in typing would publish a question called "I" and a dozen more as the sentence was
       * finished — onto a list that is public the moment the campaign is.
       */
      await tick(2000);
      expect(createFaqMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(createFaqMock).toHaveBeenCalledWith('project-1', {
        question: 'Is there a digital edition?',
        answer: 'Not yet.',
      });
      expect(screen.getByRole('heading', { level: 3, name: 'Is there a digital edition?' })).toBeInTheDocument();
    });

    it('refuses to send a blank question or a blank answer, and says which', async () => {
      const user = await openFaqs([]);

      await user.click(screen.getByRole('button', { name: 'Add the first question' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(createFaqMock).not.toHaveBeenCalled();
      expect(screen.getByText(/A question is needed/u)).toBeInTheDocument();
      expect(screen.getByText(/An answer is needed/u)).toBeInTheDocument();
    });

    it('sends only the half of an entry that changed', async () => {
      const user = await openFaqs();
      patchFaqMock.mockResolvedValue({ ...SHIPPING, answer: 'Yes, and to Austria.' });

      await user.click(screen.getByRole('button', { name: 'Edit Do you ship to Germany?' }));

      const answer = screen.getByRole('textbox', { name: 'Answer' });
      await user.clear(answer);
      await user.type(answer, 'Yes, and to Austria.');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      // The question was not retyped, so it is not in the patch: a merge patch
      // writing it back unchanged would move `updated_at` for nothing.
      expect(patchFaqMock).toHaveBeenCalledWith('faq-a', { answer: 'Yes, and to Austria.' });
    });

    it('deletes only after the creator confirms it', async () => {
      const user = await openFaqs();
      deleteFaqMock.mockResolvedValue(undefined);

      await user.click(screen.getByRole('button', { name: 'Delete When does it ship?' }));
      expect(deleteFaqMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await tick();

      expect(deleteFaqMock).toHaveBeenCalledWith('faq-b');
      expect(
        screen.queryByRole('heading', { level: 3, name: 'When does it ship?' }),
      ).not.toBeInTheDocument();
    });
  });
});
