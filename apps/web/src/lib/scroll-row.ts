import type { FocusEvent } from 'react';

/**
 * Bring a focused item of a sideways-scrolling row fully into view — issue #181.
 *
 * <h2>Why the browser's own scrolling is not enough</h2>
 *
 * Every tab row that scrolls on its own axis below a breakpoint (`EditorShell`, `ProfileTabs`,
 * `AccountNav`, `AdminNav`, `CampaignTabs`, `DashboardNav`) used to rely on the browser moving
 * the row when Tab reached an item off its edge. Chromium does not do it for an item that is
 * only partly outside the row: at 320px Tab landed on the editor's "FAQ", the profile's
 * "Backed" and the account rail's next entry with part of the label and the focus ring cut
 * off. So the row asks for it explicitly.
 *
 * <h2>One handler on the row, not one per item</h2>
 *
 * React's `onFocus` bubbles (it is `focusin` underneath), so the scroll container carries it
 * once and it covers every item, including one `ProfileTabs` focuses from an arrow key.
 *
 * <h2>`nearest` on both axes</h2>
 *
 * The smallest move that shows the item whole, and none at all when it already is — which is
 * every item on a viewport wide enough that the row does not overflow. `block: 'nearest'`
 * leaves the page where it is when the item is already on screen vertically, where `start` or
 * `center` would move the page to satisfy an alignment nobody asked for.
 *
 * <h2>Motion</h2>
 *
 * A short glide shows where the row went, and `prefers-reduced-motion: reduce` gets a jump
 * instead, as docs/motion-system.md §9.1 requires of every movement.
 */
export function revealFocusedItem(event: FocusEvent<HTMLElement>): void {
  const item = event.target;
  // The row itself taking focus, if it ever does, is not an item to reveal.
  if (item === event.currentTarget || !(item instanceof HTMLElement)) return;

  item.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
