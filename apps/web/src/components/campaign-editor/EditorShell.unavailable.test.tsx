import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EDITOR_COPY } from '../../test-editor-copy';

/*
 * The disabled-tab half of `available`, pinned against a fabricated tab list.
 *
 * IT LIVES IN ITS OWN FILE BECAUSE IT MOCKS `./tabs`, and `vi.mock` is per
 * module graph: the sibling suite asserts the navigation against the real
 * EDITOR_TABS and must keep seeing the real one.
 *
 * The list is fabricated rather than borrowed because there is no longer an
 * unbuilt section to borrow. Every row in EDITOR_TABS shipped with this epic
 * (#33, #34, #35, #37, #39), and the previous version of this test named
 * whichever section happened to be next — it was rewritten three times as the
 * epic landed, each time for a reason that had nothing to do with the behaviour
 * it was named for. §4.6 still describes people, account, and promotion, so the
 * mechanism has users ahead of it; this is what stops it rotting before they
 * arrive.
 */
vi.mock('./tabs', async () => {
  const actual = await vi.importActual<typeof import('./tabs')>('./tabs');
  return {
    ...actual,
    EDITOR_TABS: [
      { key: 'basics', label: 'Basics', segment: 'basics', available: true, issue: 33 },
      { key: 'story', label: 'Story', segment: 'story', available: false, issue: 35 },
    ],
  };
});

const { EditorShell } = await import('./EditorShell');

describe('EditorShell, for a section whose route does not exist', () => {
  function renderShell() {
    return render(
      <EditorShell projectId="project-1" copy={EDITOR_COPY} active="basics" title="A field recorder" state="DRAFT">
        <p>The basics form</p>
      </EditorShell>,
    );
  }

  /*
   * A disabled tab says "not finished yet". A stub page would leave the creator
   * unable to tell that from "broken", which is the choice `tabs.ts` documents.
   */
  it('renders it as a disabled control rather than a link', () => {
    renderShell();

    const story = screen.getByRole('button', { name: /Story/ });
    expect(story).toHaveAttribute('aria-disabled', 'true');
    expect(story).toHaveAccessibleName('Story, not available yet');
    expect(screen.queryByRole('link', { name: /Story/ })).not.toBeInTheDocument();
  });

  /*
   * `aria-disabled` rather than `disabled`, so the tab keeps its place in the tab
   * order: a keyboard user is told the section exists and is not ready, where
   * `disabled` would mean they never learn it is there at all.
   */
  it('leaves it in the tab order', () => {
    renderShell();

    expect(screen.getByRole('button', { name: /Story/ })).not.toHaveAttribute('disabled');
  });
});
