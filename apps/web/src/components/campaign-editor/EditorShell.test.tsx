import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorShell } from './EditorShell';
import { EDITOR_TABS } from './tabs';
import { EDITOR_COPY } from '../../test-editor-copy';

/**
 * Appearance is reviewed in Storybook. These cover the navigation contract: the
 * section a creator is on, the sections that do not exist yet, and reaching all
 * of them with a keyboard.
 */

function renderShell() {
  return render(
    <EditorShell projectId="project-1" copy={EDITOR_COPY} active="basics" title="A field recorder" state="DRAFT">
      <p>The basics form</p>
    </EditorShell>
  );
}

describe('EditorShell', () => {
  it('names the navigation and lists every section once', () => {
    renderShell();

    const nav = screen.getByRole('navigation', { name: EDITOR_COPY.sectionsLabel });
    expect(nav).toBeInTheDocument();

    for (const tab of EDITOR_TABS) {
      expect(screen.getByText(EDITOR_COPY.tabs[tab.key])).toBeInTheDocument();
    }
  });

  /*
   * Sections are routes, not panels in this document, so they are links with
   * `aria-current` rather than an ARIA tablist. A tablist would promise
   * same-document panels and would take the arrow keys away from the browser.
   */
  it('marks the current section as the page, and only that one', () => {
    renderShell();

    const current = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName('Basics');
    expect(current[0]).toHaveAttribute('aria-current', 'page');
  });

  it('points the available section at its own route', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'Basics' })).toHaveAttribute('href', '/en/projects/project-1/edit/basics');
  });

  /*
   * The disabled half of `available` moved to EditorShell.unavailable.test.tsx
   * when this epic finished. It used to name whichever section was next to be
   * built — Rewards, then Pre-launch — and was rewritten each time one shipped,
   * every rewrite a failure about the list rather than about the behaviour. With
   * every row in EDITOR_TABS now built there is nothing left to point at, so that
   * file fabricates a list instead and this one keeps asserting against the real
   * one. The loop below already covers both halves for whatever EDITOR_TABS says.
   *
   * A section whose route exists is a real link, with an address that can be
   * bookmarked and opened in a new tab.
   */
  it('renders a section whose route exists as a link to it', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'Rewards' })).toHaveAttribute('href', '/en/projects/project-1/edit/rewards');
  });

  /*
   * `aria-disabled` rather than `disabled`, so the tab keeps its place in the
   * tab order. A keyboard user is told the section exists and is not ready;
   * `disabled` would mean they never learn it is there at all.
   */
  it('keeps every section reachable by keyboard, in order', async () => {
    const user = userEvent.setup();
    renderShell();

    /*
     * Derived from EDITOR_TABS rather than written out, because which sections
     * are built changes with every sibling issue in the epic. Hard-coding
     * "everything but Basics is unavailable" made this test fail the moment #35
     * shipped the story route — a failure about the list, not about the
     * behaviour the test is named for.
     */
    for (const tab of EDITOR_TABS) {
      await user.tab();
      const name = EDITOR_COPY.tabs[tab.key];
      expect(document.activeElement).toHaveAccessibleName(
        tab.available ? name : `${name}${EDITOR_COPY.notAvailable}`,
      );
    }
  });

  it('puts one control in the navigation per section, and no more', () => {
    renderShell();

    /*
     * The count matters because the loop above walks EDITOR_TABS. A tab dropped
     * from the navigation markup would leave that loop tabbing onto whatever came
     * next and asserting a name that happened to match, so the list and the
     * markup are checked against each other rather than each against itself.
     */
    const nav = screen.getByRole('navigation', { name: 'Campaign sections' });
    const controls = [
      ...within(nav).getAllByRole('link'),
      ...within(nav).queryAllByRole('button'),
    ];
    expect(controls).toHaveLength(EDITOR_TABS.length);
  });

  it('says which state the campaign is in, in words', () => {
    renderShell();
    // Colour alone must never carry meaning (docs/ui-kit.md §9.2).
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders the tab content it was given', () => {
    renderShell();
    expect(screen.getByText('The basics form')).toBeInTheDocument();
  });
});
