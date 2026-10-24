import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  discardRevision,
  getProjectEdit,
  submitRevision,
  type ProjectEdit,
} from '../../lib/projects/api';
import { RevisionNotice } from './RevisionNotice';
import { EDITOR_COPY } from '../../test-editor-copy';

/**
 * The notice's four situations and the two actions. Appearance is reviewed in Storybook, where
 * the editor has no stories; what is asserted here is what a creator would be misled by.
 */

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  getProjectEdit: vi.fn(),
  submitRevision: vi.fn(),
  discardRevision: vi.fn(),
}));

const getMock = vi.mocked(getProjectEdit);
const submitMock = vi.mocked(submitRevision);
const discardMock = vi.mocked(discardRevision);

const copy = EDITOR_COPY.revision;

const LIVE: ProjectEdit = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'LIVE',
  title: 'A field recorder',
  lockedFields: ['goal'],
  revision: null,
  rejectedRevision: null,
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-02T09:00:00Z',
};

function withRevision(status: 'DRAFT' | 'PENDING', changedFields: string[]): ProjectEdit {
  return {
    ...LIVE,
    revision: {
      id: 'revision-1',
      status,
      changedFields,
      submittedAt: status === 'PENDING' ? '2026-10-03T09:00:00Z' : null,
      updatedAt: '2026-10-03T09:00:00Z',
    },
  };
}

const DRAFT = withRevision('DRAFT', ['title', 'story']);
const PENDING = withRevision('PENDING', ['blurb']);
const REJECTED: ProjectEdit = {
  ...LIVE,
  rejectedRevision: { id: 'revision-0', reason: 'The cover shows another brand.', decidedAt: '2026-10-04T09:00:00Z' },
};

/** Holds the project the way a panel does, so the notice's `onProject` is a real round trip. */
function Harness({ initial, onDiscarded }: { initial: ProjectEdit; onDiscarded?: () => void }) {
  const [project, setProject] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setProject(withRevision('DRAFT', ['blurb']))}>
        save an edit
      </button>
      <RevisionNotice
        projectId="project-1"
        project={project}
        copy={copy}
        onProject={setProject}
        onDiscarded={onDiscarded}
      />
    </>
  );
}

const submitButton = () => screen.getByRole('button', { name: copy.submit });
const discardButton = () => screen.getByRole('button', { name: copy.discard });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RevisionNotice', () => {
  it('draws nothing when there is no edit and no rejection', () => {
    const { container } = render(<Harness initial={LIVE} />);
    expect(container.querySelector('[data-revision]')).toBeNull();
    expect(screen.queryByRole('button', { name: copy.submit })).toBeNull();
  });

  it('says a draft is not public, that backers see the approved version, and which sections changed', () => {
    render(<Harness initial={DRAFT} />);

    expect(screen.getByText(copy.draftTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.draftBody)).toBeInTheDocument();
    expect(screen.getByText(copy.changedHeading)).toBeInTheDocument();
    expect(screen.getByText(copy.fields.title)).toBeInTheDocument();
    expect(screen.getByText(copy.fields.story)).toBeInTheDocument();
    expect(submitButton()).not.toHaveAttribute('aria-disabled', 'true');
    expect(discardButton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('shows a pending edit as awaiting review with the send action unavailable', async () => {
    const user = userEvent.setup();
    render(<Harness initial={PENDING} />);

    expect(screen.getByText(copy.pendingTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.pendingBody)).toBeInTheDocument();
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');

    await user.click(submitButton());
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('shows the moderator reason for a rejected edit and offers no actions', () => {
    render(<Harness initial={REJECTED} />);

    expect(screen.getByText(copy.rejectedTitle)).toBeInTheDocument();
    expect(screen.getByText(/The cover shows another brand\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.submit })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.discard })).toBeNull();
  });

  it('sends the edit for review and shows it as pending', async () => {
    const user = userEvent.setup();
    submitMock.mockResolvedValue(withRevision('PENDING', ['title', 'story']));
    render(<Harness initial={DRAFT} />);

    await user.click(submitButton());

    expect(submitMock).toHaveBeenCalledWith('project-1');
    expect(await screen.findByText(copy.pendingTitle)).toBeInTheDocument();
  });

  it('asks before discarding, and keeps the edit if the creator backs out', async () => {
    const user = userEvent.setup();
    render(<Harness initial={DRAFT} />);

    await user.click(discardButton());
    expect(screen.getByText(copy.confirmDiscardTitle)).toBeInTheDocument();
    expect(discardMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: copy.keepEditing }));
    expect(screen.queryByText(copy.confirmDiscardTitle)).toBeNull();
    expect(discardMock).not.toHaveBeenCalled();
  });

  it('discards on confirmation, clears the notice and tells the tab', async () => {
    const user = userEvent.setup();
    const onDiscarded = vi.fn();
    discardMock.mockResolvedValue(LIVE);
    render(<Harness initial={DRAFT} onDiscarded={onDiscarded} />);

    await user.click(discardButton());
    await user.click(screen.getByRole('button', { name: copy.confirmDiscard }));

    expect(discardMock).toHaveBeenCalledWith('project-1');
    await waitFor(() => expect(screen.queryByText(copy.draftTitle)).toBeNull());
    expect(onDiscarded).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NO_OPEN_REVISION'],
    ['ALREADY_SUBMITTED'],
    ['NO_CHANGES'],
    ['NOT_PENDING'],
  ] as const)('words 409 %s and re-reads the project', async (reason) => {
    const user = userEvent.setup();
    submitMock.mockRejectedValue(
      new ApiError(409, { code: 'REVISION_NOT_AVAILABLE', meta: { reason } }),
    );
    getMock.mockResolvedValue(PENDING);
    render(<Harness initial={DRAFT} />);

    await user.click(submitButton());

    expect(await screen.findByText(copy.refusals[reason])).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('project-1');
    expect(await screen.findByText(copy.pendingTitle)).toBeInTheDocument();
  });

  it('keeps the edit and says so when the request cannot reach the server', async () => {
    const user = userEvent.setup();
    submitMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Harness initial={DRAFT} />);

    await user.click(submitButton());

    expect(await screen.findByText(copy.failed)).toBeInTheDocument();
    expect(screen.getByText(copy.draftTitle)).toBeInTheDocument();
  });

  it('tells the creator that editing a pending edit returned it to draft', async () => {
    const user = userEvent.setup();
    render(<Harness initial={PENDING} />);
    expect(screen.queryByText(copy.returnedToDraft)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'save an edit' }));

    expect(await screen.findByText(copy.returnedToDraft)).toBeInTheDocument();
    expect(screen.getByText(copy.draftTitle)).toBeInTheDocument();
  });
});
