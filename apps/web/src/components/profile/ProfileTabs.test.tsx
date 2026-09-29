import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileTabs, type ProfileTab } from './ProfileTabs';

/**
 * The profile's tab widget — §4.2 P-04 to P-06, issue #274.
 *
 * WHAT THESE COVER, and why they are behaviour rather than markup:
 *
 *   - **the whole tablist is one tab stop.** A roving `tabIndex` is invisible in a screenshot
 *     and is the difference between Tab reaching the content and Tab walking through three
 *     controls. It is the first thing a refactor breaks.
 *   - **arrow keys move and wrap, Home and End go to the ends.** A component that takes
 *     `role="tab"` has promised the APG keyboard contract; a promise nothing checks is a
 *     promise that lapses.
 *   - **selection follows focus**, which is correct here only because every panel is already
 *     in the document — the reason the pattern warns against it cannot happen.
 *   - the panels are labelled by their tabs and the hidden ones are hidden, so a screen reader
 *     is not read three panels at once.
 */

const TABS: readonly ProfileTab[] = [
  { key: 'created', label: 'Created', count: 2, panel: <p>Two campaigns</p> },
  { key: 'backed', label: 'Backed', panel: <p>Backed campaigns</p> },
  { key: 'about', label: 'About', panel: <p>A biography</p> },
];

function renderTabs() {
  return render(<ProfileTabs tabs={TABS} label="Profile sections" />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the tablist', () => {
  it('is named, so a reader who arrives at it out of context knows what it is', () => {
    renderTabs();
    expect(screen.getByRole('tablist', { name: 'Profile sections' })).toBeInTheDocument();
  });

  it('opens on the first tab and marks only that one selected', () => {
    renderTabs();

    expect(screen.getByRole('tab', { name: /Created/u })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Backed' })).toHaveAttribute('aria-selected', 'false');
  });

  it('costs one tab stop for all three, not three', () => {
    renderTabs();

    expect(screen.getByRole('tab', { name: /Created/u })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Backed' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('tabindex', '-1');
  });

  it('carries a count into the accessible name only where one is given', () => {
    renderTabs();

    // "Created, 2" — the figure is what says the list is not empty, and it is read out.
    expect(screen.getByRole('tab', { name: /Created/u })).toHaveAccessibleName(/2/u);
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAccessibleName('About');
  });

  /**
   * #177. A scroll container clips whatever overflows it, and the ring is drawn four pixels
   * outside the tab (2px wide, 2px off — `theme.css`'s unlayered `:focus-visible` rule). The
   * row pads itself by exactly that on every side and gives it back with a negative margin,
   * as `DashboardNav` and `CampaignTabs` do.
   */
  it('leaves room inside the scrolling row for the focus ring on every tab', () => {
    renderTabs();

    const row = screen.getByRole('tablist', { name: 'Profile sections' });
    expect(row).toHaveClass('overflow-x-auto');
    expect(row).toHaveClass('p-1');
    expect(row).toHaveClass('-m-1');

    for (const tab of screen.getAllByRole('tab')) {
      // An inset offset here would be outranked by the kit's rule anyway; nothing may ask for one.
      expect(tab.className).not.toContain('outline-offset-[-');
      expect(tab.className).not.toContain('outline-none');
    }
  });
});

describe('the keyboard contract', () => {
  it('moves the selection with the arrow keys, and selection follows focus', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.tab();
    expect(screen.getByRole('tab', { name: /Created/u })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    const backed = screen.getByRole('tab', { name: 'Backed' });
    expect(backed).toHaveFocus();
    expect(backed).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Backed campaigns')).toBeVisible();
  });

  it('wraps at both ends, because a short bounded list is cheaper to wrap than to stop', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Created/u })).toHaveAttribute('aria-selected', 'true');
  });

  it('goes to the ends with Home and End', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.tab();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /Created/u })).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * #181. At 320px "Backed" sat half off the row's edge and Chromium left it there when focus
   * arrived. The row's focus handler covers Tab and the arrow keys alike, because the arrow
   * keys move focus too.
   */
  it('scrolls the tab that takes focus fully into view, from Tab and from an arrow key', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    renderTabs();

    await user.tab();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: /Created/u }));

    await user.keyboard('{ArrowRight}');
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: 'Backed' }));
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    });
  });
});

describe('the panels', () => {
  it('shows one and hides the rest', () => {
    renderTabs();

    expect(screen.getByText('Two campaigns')).toBeVisible();
    expect(screen.getByText('Backed campaigns')).not.toBeVisible();
    expect(screen.getByText('A biography')).not.toBeVisible();
  });

  it('names each panel by the tab that opens it', () => {
    renderTabs();

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAccessibleName(/Created/u);
  });

  it('is reachable by keyboard after the tablist, so a panel with no links is not stranded', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.tab();
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('switches on a pointer press too', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByText('A biography')).toBeVisible();
    expect(screen.getByText('Two campaigns')).not.toBeVisible();
  });
});
