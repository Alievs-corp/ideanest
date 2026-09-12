import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { createProject, type ProjectEdit } from '../../lib/projects/api';
import { NewProjectForm } from './NewProjectForm';
import { EDITOR_COPY, NEW_PROJECT_COPY } from '../../test-editor-copy';

/**
 * The one form in the editor with a submit button, so the things worth testing
 * are the refusals: a title that is too long, a request that failed, and a
 * second press that must not produce a second draft.
 */

const replace = vi.fn();

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
}));

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  createProject: vi.fn(),
}));

const createProjectMock = vi.mocked(createProject);

const CREATED = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'DRAFT',
  title: 'A field recorder',
  latePledgeEnabled: false,
  lockedFields: [],
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
} satisfies ProjectEdit;

const start = (): HTMLElement => screen.getByRole('button', { name: 'Start editing' });

beforeEach(() => {
  vi.clearAllMocks();
  createProjectMock.mockResolvedValue(CREATED);
});

describe('NewProjectForm', () => {
  it('will not create anything until a title has been typed', () => {
    render(<NewProjectForm
        copy={NEW_PROJECT_COPY}
        counter={EDITOR_COPY.characterCount}
        locale={EDITOR_COPY.locale}
      />);
    expect(start()).toBeDisabled();
  });

  it('creates the draft and goes straight into the editor', async () => {
    const user = userEvent.setup();
    render(<NewProjectForm
        copy={NEW_PROJECT_COPY}
        counter={EDITOR_COPY.characterCount}
        locale={EDITOR_COPY.locale}
      />);

    await user.type(screen.getByRole('textbox', { name: 'Project title' }), 'A field recorder');
    await user.click(start());

    expect(createProjectMock).toHaveBeenCalledExactlyOnceWith({ title: 'A field recorder' });
    /*
     * `replace`, so the back button does not return to a page that would offer
     * to create a second draft.
     */
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en/projects/project-1/edit/basics'));
  });

  it('refuses a title over sixty characters instead of letting the service do it', async () => {
    const user = userEvent.setup();
    render(<NewProjectForm
        copy={NEW_PROJECT_COPY}
        counter={EDITOR_COPY.characterCount}
        locale={EDITOR_COPY.locale}
      />);

    await user.type(screen.getByRole('textbox', { name: 'Project title' }), 'a'.repeat(61));

    expect(screen.getByText('A title is 60 characters or fewer. Remove 1.')).toBeInTheDocument();
    expect(start()).toBeDisabled();
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it('stays where it is and explains itself when the draft cannot be created', async () => {
    const user = userEvent.setup();
    createProjectMock.mockRejectedValue(new ApiError(401, null));
    render(<NewProjectForm
        copy={NEW_PROJECT_COPY}
        counter={EDITOR_COPY.characterCount}
        locale={EDITOR_COPY.locale}
      />);

    await user.type(screen.getByRole('textbox', { name: 'Project title' }), 'A field recorder');
    await user.click(start());

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to start a project.');
    expect(replace).not.toHaveBeenCalled();
    // Still typed, still submittable once they have signed in.
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue('A field recorder');
  });

  it('does not create a second draft when the button is pressed twice', async () => {
    const user = userEvent.setup();
    createProjectMock.mockReturnValue(new Promise<ProjectEdit>(() => {}));
    render(<NewProjectForm
        copy={NEW_PROJECT_COPY}
        counter={EDITOR_COPY.characterCount}
        locale={EDITOR_COPY.locale}
      />);

    await user.type(screen.getByRole('textbox', { name: 'Project title' }), 'A field recorder');
    await user.click(start());
    await user.click(screen.getByRole('button', { name: 'Creating the draft' }));

    expect(createProjectMock).toHaveBeenCalledOnce();
  });
});
