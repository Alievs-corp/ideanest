import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EDITOR_TABS } from '@ideanest/campaign-editor/tabs';
import { EditorSectionsMenu } from './EditorSectionsMenu';
import { EDITOR_COPY } from '../../test-editor-copy';

/**
 * Appearance is reviewed in the browser. These cover what a phone's reader depends on: the
 * button saying where they are, every section reachable from the panel, and the panel's focus
 * contract (docs/ui-kit.md §7.14).
 */

function renderMenu() {
  return render(<EditorSectionsMenu projectId="project-1" copy={EDITOR_COPY} active="story" />);
}

describe('EditorSectionsMenu', () => {
  it('names the section being edited and how far along the list it is', () => {
    renderMenu();

    const button = screen.getByRole('button', { name: `${EDITOR_COPY.sectionsOpen}: Story` });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent(`3/${EDITOR_TABS.length}`);
  });

  it('opens on every section, in order, with the current one marked as the page', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: /Story/ }));

    const panel = screen.getByRole('dialog', { name: EDITOR_COPY.sectionsLabel });
    const links = within(panel).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(
      EDITOR_TABS.map((tab, index) => `${index + 1}${EDITOR_COPY.tabs[tab.key]}`),
    );
    // The number is for the eye; the name is only the section's.
    expect(links[0]).toHaveAccessibleName(EDITOR_COPY.tabs.basics);

    const current = links.filter((link) => link.hasAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName('Story');
    expect(within(panel).getByRole('link', { name: 'Rewards' })).toHaveAttribute(
      'href',
      '/en/projects/project-1/edit/rewards',
    );
  });

  it('closes on Escape and gives focus back to its button', async () => {
    const user = userEvent.setup();
    renderMenu();
    const button = screen.getByRole('button', { name: /Story/ });

    await user.click(button);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes from its own close control, which has a name', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: /Story/ }));
    await user.click(screen.getByRole('button', { name: EDITOR_COPY.sectionsClose }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when a section is chosen', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: /Story/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Rewards' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
