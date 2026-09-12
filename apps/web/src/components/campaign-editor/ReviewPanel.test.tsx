import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  getProjectChecklist,
  getProjectEdit,
  launchProject,
  submitProject,
  type ChecklistItem,
  type ProjectChecklist,
  type ProjectEdit,
} from '../../lib/projects/api';
import { ReviewPanel } from './ReviewPanel';
import { EDITOR_COPY } from '../../test-editor-copy';

/**
 * Appearance is reviewed in Storybook. These cover what the review tab has to get
 * right or quietly mislead somebody: that a suggestion is never presented as a
 * barrier, that the difference between the two is not carried by colour, that the
 * score can be read rather than only looked at, that a moderator's note reaches
 * the creator, and that the server's refusal wins over what this screen was
 * showing a moment earlier.
 */

const push = vi.fn();

/*
 * `ReviewPanel` navigates to the pricing page when a submission is refused for want of a
 * plan, so it holds a router now.
 *
 * Spread first so the real module's other exports survive. `i18n/navigation.tsx` builds its
 * wrappers at import time and reads `redirect` and `permanentRedirect` while doing so, and a
 * factory that replaced the module wholesale left those undefined.
 */
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  getProjectEdit: vi.fn(),
  getProjectChecklist: vi.fn(),
  submitProject: vi.fn(),
  launchProject: vi.fn(),
}));

const getProjectEditMock = vi.mocked(getProjectEdit);
const getProjectChecklistMock = vi.mocked(getProjectChecklist);
const submitProjectMock = vi.mocked(submitProject);
const launchProjectMock = vi.mocked(launchProject);

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

function item(overrides: Partial<ChecklistItem>): ChecklistItem {
  return {
    requirement: 'TITLE',
    label: 'Title',
    satisfied: true,
    section: 'basics',
    ...overrides,
  };
}

const DONE_BLOCKERS: readonly ChecklistItem[] = [
  item({ requirement: 'TITLE', label: 'Title' }),
  item({ requirement: 'SUMMARY', label: 'Short summary' }),
];

function checklist(overrides: Partial<ProjectChecklist> = {}): ProjectChecklist {
  return {
    projectId: 'project-1',
    state: 'DRAFT',
    submittable: false,
    score: 60,
    blocking: [
      ...DONE_BLOCKERS,
      item({
        requirement: 'COVER_IMAGE',
        label: 'Cover image',
        satisfied: false,
        section: 'basics',
        detail: 'A cover image is required. It is the campaign everywhere it is listed.',
      }),
      item({
        requirement: 'RISKS',
        label: 'Risks and challenges',
        satisfied: false,
        section: 'story',
        detail: 'The risks section is 12 characters. At least 200 are needed.',
      }),
    ],
    advisory: [
      item({
        requirement: 'REWARDS_OFFERED',
        label: 'At least one reward',
        satisfied: false,
        section: 'rewards',
        detail: 'There is nothing for a backer to choose.',
      }),
    ],
    ...overrides,
  };
}

/** Everything §5.3 wants, and nothing more. */
function completeChecklist(overrides: Partial<ProjectChecklist> = {}): ProjectChecklist {
  return checklist({
    submittable: true,
    score: 83,
    blocking: [...DONE_BLOCKERS],
    ...overrides,
  });
}

async function renderPanel(): Promise<void> {
  render(<ReviewPanel projectId="project-1" copy={EDITOR_COPY} />);
  await screen.findByRole('heading', { name: 'Required before you can submit' });
}

beforeEach(() => {
  vi.clearAllMocks();
  getProjectEditMock.mockResolvedValue(PROJECT);
  getProjectChecklistMock.mockResolvedValue(checklist());
});

describe('ReviewPanel', () => {
  it('groups the requirements into what refuses a submission and what only advises', async () => {
    await renderPanel();

    const required = screen.getByRole('region', { name: 'Required before you can submit' });
    const recommended = screen.getByRole('region', { name: 'Recommended, but not required' });

    // Two headed groups. A single list sorted by severity is one careless render
    // away from an interface that shows a suggestion as a barrier.
    expect(within(required).getByText('Cover image')).toBeInTheDocument();
    expect(within(recommended).getByText('At least one reward')).toBeInTheDocument();
    expect(within(required).queryByText('At least one reward')).not.toBeInTheDocument();
  });

  /*
   * docs/ui-kit.md §9.2: colour alone must never carry meaning. A checklist drawn
   * only in red and green is exactly that failure, so every row says its status in
   * words as well as in an icon.
   */
  it('says whether each requirement is done, in words', async () => {
    await renderPanel();

    expect(screen.getByText('Title').textContent).toContain('Done');
    expect(screen.getByText('Cover image').textContent).toContain('Required, not done');
    expect(screen.getByText('At least one reward').textContent).toContain(
      'Recommended, not done',
    );
  });

  it('explains each failing requirement in the campaign’s own numbers', async () => {
    await renderPanel();

    expect(
      screen.getByText('The risks section is 12 characters. At least 200 are needed.'),
    ).toBeInTheDocument();
  });

  it('links every failing requirement to the section that fixes it', async () => {
    await renderPanel();

    const cover = screen.getByRole('link', { name: /Cover image/ });
    expect(cover).toHaveAttribute('href', '/en/projects/project-1/edit/basics');

    // Named by requirement as well as by section: four links called "Fix in
    // Basics" are four indistinguishable links in a screen reader's list.
    expect(screen.getByRole('link', { name: 'Fix in Story: Risks and challenges' })).toHaveAttribute('href', '/en/projects/project-1/edit/story');

    // A satisfied requirement is not something to go and fix.
    expect(screen.queryByRole('link', { name: /Fix in Basics: Title/ })).not.toBeInTheDocument();
  });

  it('reports the score as a sentence, not only as a bar', async () => {
    await renderPanel();

    // The counts are the part a bar cannot carry, and they are what say whether
    // the remainder is optional.
    expect(
      screen.getByText('60% complete. 2 of 4 required items done, 0 of 1 recommended.'),
    ).toBeInTheDocument();
    // The bar is a picture of the same number, so it is not announced twice.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  describe('the submit control', () => {
    it('is disabled while a required item is missing, and says why', async () => {
      const user = userEvent.setup();
      await renderPanel();

      const submit = screen.getByRole('button', { name: 'Submit for review' });
      expect(submit).toHaveAttribute('aria-disabled', 'true');
      expect(submit).toHaveAccessibleDescription(/2 required items are not done yet/);
      // The recommended list must not read as part of the reason.
      expect(submit).toHaveAccessibleDescription(/recommended items are not part of this/);

      await user.click(submit);
      expect(submitProjectMock).not.toHaveBeenCalled();
    });

    /*
     * `aria-disabled` rather than `disabled`, the same choice the section
     * navigation makes: the control keeps its place in the tab order, and pressing
     * it takes the creator to the list of what is missing instead of doing nothing.
     */
    it('stays reachable by keyboard and moves focus to what is missing', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByRole('button', { name: 'Submit for review' }));

      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Required before you can submit' }),
      );
    });

    it('submits when nothing is blocking, and takes the new state from the answer', async () => {
      const user = userEvent.setup();
      getProjectChecklistMock.mockResolvedValueOnce(completeChecklist());
      submitProjectMock.mockResolvedValue({ ...PROJECT, state: 'SUBMITTED' });
      getProjectChecklistMock.mockResolvedValueOnce(
        completeChecklist({ state: 'SUBMITTED', submittable: true }),
      );

      await renderPanel();
      await user.click(screen.getByRole('button', { name: 'Submit for review' }));

      expect(submitProjectMock).toHaveBeenCalledWith('project-1');
      // Awaiting review is a real state, and it must not look like an error.
      await screen.findByText(/with our moderators/);
      expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
    });

    /*
     * The screen's checklist was read when the tab opened. The server re-checks the
     * same rules on the write, and if it refuses, its list is the true one — a
     * collaborator may have emptied a field since, or the deployment may enforce a
     * rule this build has never heard of.
     */
    it('renders the server’s refusal even when this screen thought it was complete', async () => {
      const user = userEvent.setup();
      getProjectChecklistMock.mockResolvedValue(completeChecklist());
      submitProjectMock.mockRejectedValue(
        new ApiError(409, {
          code: 'PROJECT_NOT_SUBMITTABLE',
          detail: 'Some of what a campaign needs before it can be reviewed is still missing.',
          meta: {
            unmet: [
              {
                requirement: 'COVER_IMAGE',
                label: 'Cover image',
                section: 'basics',
                detail: 'A cover image is required.',
              },
            ],
          },
        }),
      );

      await renderPanel();
      await user.click(screen.getByRole('button', { name: 'Submit for review' }));

      const refusal = await screen.findByRole('alert');
      expect(refusal).toHaveTextContent('This campaign was not submitted');
      expect(refusal).toHaveTextContent('Cover image: A cover image is required.');
    });

    it('renders a refusal that names no requirements at all', async () => {
      const user = userEvent.setup();
      getProjectChecklistMock.mockResolvedValue(completeChecklist());
      submitProjectMock.mockRejectedValue(
        new ApiError(409, {
          code: 'PROJECT_TRANSITION_NOT_ALLOWED',
          detail: 'A project in SUBMITTED cannot move to SUBMITTED.',
          meta: { state: 'SUBMITTED', requested: 'SUBMITTED', allowed: [] },
        }),
      );

      await renderPanel();
      await user.click(screen.getByRole('button', { name: 'Submit for review' }));

      // Somebody else, or another tab, moved it. The server's own words, and a way
      // to reload rather than a list of requirements that are all fine.
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'A project in SUBMITTED cannot move to SUBMITTED.',
      );
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    });

    /*
     * THE ONE REFUSAL THIS SCREEN CANNOT ANSWER IN PLACE.
     *
     * Everything else the server says no to is something on this campaign, and the panel
     * renders it beside the thing to fix. A creator with no plan has nothing to fix here, so
     * the answer is the pricing page -- and the two parameters are what let that page explain
     * why they are looking at a price list.
     */
    it('takes a creator with no plan to the pricing page rather than arguing with them here', async () => {
      const user = userEvent.setup();
      getProjectChecklistMock.mockResolvedValue(completeChecklist());
      submitProjectMock.mockRejectedValue(
        new ApiError(403, {
          code: 'SUBSCRIPTION_REQUIRED',
          detail: 'Building a campaign is free. Sending one for review needs an active plan.',
          meta: { pricingPath: '/pricing' },
        }),
      );

      await renderPanel();
      await user.click(screen.getByRole('button', { name: 'Submit for review' }));

      // `stringContaining` because `useRouter` prefixes the reader's language, which is what
      // stops a Russian creator being dropped onto an English page by a redirect they did not
      // ask for.
      await waitFor(() =>
        expect(push).toHaveBeenCalledWith(
          expect.stringContaining('/pricing?from=submit&project=project-1'),
        ),
      );
    });

    /*
     * AND THE ONE THAT LOOKS LIKE IT AND IS NOT.
     *
     * This creator has paid. The answer may be to withdraw a campaign or lower a goal, and
     * sending a paying customer to a price list reads as the platform trying to sell them
     * something instead of answering them.
     */
    it('stays put when the plan exists and does not stretch to this campaign', async () => {
      const user = userEvent.setup();
      getProjectChecklistMock.mockResolvedValue(completeChecklist());
      submitProjectMock.mockRejectedValue(
        new ApiError(403, {
          code: 'PLAN_LIMIT_EXCEEDED',
          detail: 'Plan STARTER allows 1 campaigns at once; this account holds 1',
          meta: {
            limit: 'ACTIVE_CAMPAIGNS',
            plan: 'STARTER',
            allowed: '1',
            actual: '1',
            pricingPath: '/pricing',
          },
        }),
      );

      await renderPanel();
      await user.click(screen.getByRole('button', { name: 'Submit for review' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Plan STARTER allows 1 campaigns at once',
      );
      expect(push).not.toHaveBeenCalled();
      // The way out is offered rather than taken.
      expect(
        screen.getByRole('link', { name: 'See what the other plans allow' }),
      ).toBeInTheDocument();
    });
  });

  describe('the launch control', () => {
    /**
     * A cleared campaign is not a published one, and until #385 there was nothing on this
     * screen that could make it one: every public listing shows `LIVE` alone, and the only
     * edge into `LIVE` is an endpoint no part of this application called. A campaign could
     * be approved and stay invisible for as long as its creator was prepared to wait.
     */
    async function renderCleared(state: ProjectChecklist['state'] = 'APPROVED') {
      getProjectEditMock.mockResolvedValue({ ...PROJECT, state });
      getProjectChecklistMock.mockResolvedValue(completeChecklist({ state }));
      const user = userEvent.setup();
      await renderPanel();
      return user;
    }

    it('is offered once moderation has cleared the campaign', async () => {
      await renderCleared();

      expect(screen.getByRole('button', { name: 'Launch this campaign' })).toBeInTheDocument();
      // And the submit control is gone: §6.1 has no APPROVED -> SUBMITTED edge, so offering
      // it would be offering a 409.
      expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
    });

    it('is offered to a campaign waiting for its scheduled time, which can still be brought forward', async () => {
      await renderCleared('SCHEDULED');

      expect(screen.getByRole('button', { name: 'Launch this campaign' })).toBeInTheDocument();
    });

    it('is not offered while the campaign is still a draft', async () => {
      await renderPanel();

      expect(screen.queryByRole('button', { name: 'Launch this campaign' })).not.toBeInTheDocument();
    });

    it('asks before launching, and says what freezes', async () => {
      const user = await renderCleared();

      await user.click(screen.getByRole('button', { name: 'Launch this campaign' }));

      // Two presses, not one: launching takes money from strangers and §6.1 has no edge back
      // to a draft.
      expect(
        screen.getByRole('group', { name: 'Launch this campaign now?' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/cannot be taken back to a draft/)).toBeInTheDocument();
      expect(launchProjectMock).not.toHaveBeenCalled();

      // And focus is on the answer to the question that just appeared, which is what a
      // dialog would have done for a reader who cannot see it arrive.
      expect(screen.getByRole('button', { name: 'Launch now' })).toHaveFocus();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(launchProjectMock).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('group', { name: 'Launch this campaign now?' }),
      ).not.toBeInTheDocument();
    });

    it('launches on confirmation and takes the new state from the answer', async () => {
      const user = await renderCleared();
      launchProjectMock.mockResolvedValue({ ...PROJECT, state: 'LIVE' });
      // What the tab re-reads afterwards, which is the state the panel then draws.
      getProjectChecklistMock.mockResolvedValue(completeChecklist({ state: 'LIVE' }));

      await user.click(screen.getByRole('button', { name: 'Launch this campaign' }));
      await user.click(screen.getByRole('button', { name: 'Launch now' }));

      await waitFor(() => expect(launchProjectMock).toHaveBeenCalledWith('project-1'));
      // The state the server answered with, not the one this screen assumed.
      expect(await screen.findByText(/live and taking pledges/)).toBeInTheDocument();
    });

    it('names a refusal and leaves the confirmation on screen with it', async () => {
      launchProjectMock.mockRejectedValue(
        new ApiError(
          409,
          { code: 'PROJECT_NOT_LAUNCHABLE', detail: 'This campaign has no goal.' },
          'not launchable',
        ),
      );
      const user = await renderCleared();

      await user.click(screen.getByRole('button', { name: 'Launch this campaign' }));
      await user.click(screen.getByRole('button', { name: 'Launch now' }));

      expect(await screen.findByText('This campaign has no goal.')).toBeInTheDocument();
      // Still asking. Collapsing it would return the creator to a screen that looks exactly
      // as it did before they pressed anything.
      expect(
        screen.getByRole('group', { name: 'Launch this campaign now?' }),
      ).toBeInTheDocument();
    });
  });

  describe('the moderation outcome', () => {
    /*
     * §6.1 added CHANGES_REQUESTED so a fixable campaign could be sent back rather
     * than rejected. A creator told "changes requested" and no reason is the exact
     * failure that state exists to prevent.
     */
    it('shows the moderator’s note prominently when changes have been requested', async () => {
      getProjectChecklistMock.mockResolvedValue(
        completeChecklist({
          state: 'CHANGES_REQUESTED',
          moderation: {
            outcome: 'CHANGES_REQUESTED',
            note: 'The summary describes a different product.',
            decidedAt: '2026-08-14T10:00:00.000Z',
            current: true,
          },
        }),
      );

      await renderPanel();

      const alerts = screen.getAllByRole('alert');
      expect(alerts[0]).toHaveTextContent('Our moderators have asked for changes');
      expect(alerts[0]).toHaveTextContent('The summary describes a different product.');
      // And it can still be fixed and sent back in, which is the whole point.
      expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
    });

    it('shows a rejection’s reason, and offers no way to submit again', async () => {
      getProjectChecklistMock.mockResolvedValue(
        completeChecklist({
          state: 'REJECTED',
          moderation: {
            outcome: 'REJECTED',
            note: '§5.4: resale goods.',
            decidedAt: '2026-08-14T10:00:00.000Z',
            current: true,
          },
        }),
      );

      await renderPanel();

      expect(screen.getAllByRole('alert')[0]).toHaveTextContent('§5.4: resale goods.');
      expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
    });

    /*
     * After a resubmission the campaign is in SUBMITTED and the newest note is
     * still the change request's. The server says which by sending `current`, and a
     * banner shouting about changes at somebody who has already made them is the
     * reason it does.
     */
    it('does not shout about a decision that has been acted on', async () => {
      getProjectChecklistMock.mockResolvedValue(
        completeChecklist({
          state: 'SUBMITTED',
          moderation: {
            outcome: 'CHANGES_REQUESTED',
            note: 'The summary describes a different product.',
            decidedAt: '2026-08-14T10:00:00.000Z',
            current: false,
          },
        }),
      );

      await renderPanel();

      expect(screen.queryByText(/Our moderators have asked for changes/)).not.toBeInTheDocument();
      expect(screen.getByText(/with our moderators/)).toBeInTheDocument();
    });

    it('shows nothing about moderation before a moderator has decided anything', async () => {
      await renderPanel();

      expect(screen.queryByText(/moderators/)).not.toBeInTheDocument();
    });
  });

  it('reports a checklist that could not be loaded, and offers to try again', async () => {
    getProjectChecklistMock.mockRejectedValue(new ApiError(500, null));

    render(<ReviewPanel projectId="project-1" copy={EDITOR_COPY} />);

    await waitFor(() =>
      expect(screen.getByText('This campaign could not be loaded')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
