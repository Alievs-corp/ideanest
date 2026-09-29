import type { FocusEvent } from 'react';

/**
 * Bring a focused item of a sideways-scrolling row fully into view.
 *
 * (The issue is deliberately not cited by number here: the design-token test reads a `#` and
 * three digits in this package as a colour literal. It is the web's issue one-eight-one.)
 *
 * <h2>Why the browser's own scrolling is not enough</h2>
 *
 * Every row that scrolls on its own axis — `ChipRow` here, and the web's tab rows
 * (`EditorShell`, `ProfileTabs`, `AccountNav`, `AdminNav`, `CampaignTabs`, `DashboardNav`) —
 * used to rely on the browser moving the row when Tab reached an item off its edge. Chromium
 * does not do it for an item that is only partly outside the row: at 320px Tab landed on the
 * editor's "FAQ", the profile's "Backed" and the account rail's next entry with part of the
 * label and the focus ring cut off. So the row asks for it explicitly.
 *
 * <h2>One handler on the row, not one per item</h2>
 *
 * React's `onFocus` bubbles (it is `focusin` underneath), so the scroll container carries it
 * once and it covers every item, including one a roving-tabindex widget focuses from an arrow
 * key.
 *
 * <h2>`nearest` on both axes</h2>
 *
 * The smallest move that shows the item whole, and none at all when it already is — which is
 * every item on a viewport wide enough that the row does not overflow. `block: 'nearest'`
 * leaves the page where it is when the item is already on screen vertically, where `start` or
 * `center` would move the page to satisfy an alignment nobody asked for.
 *
 * <h2>It jumps rather than glides</h2>
 *
 * `behavior: 'auto'`, which is instant — the same move the browser makes when it scrolls a
 * focused element into view itself. docs/motion-system.md §5 keeps smooth scrolling to the
 * marketing routes and gives the working surfaces these rows sit on (the campaign editor,
 * account settings, the admin console) no motion to spend, and `DashboardNav` already brings
 * its current tab into view the same way. An instant move is also what
 * `prefers-reduced-motion` would ask for, so there is no second branch to keep.
 */
export function revealFocusedItem(event: FocusEvent<HTMLElement>): void {
  const item = event.target;
  // The row itself taking focus, if it ever does, is not an item to reveal.
  if (item === event.currentTarget || !(item instanceof HTMLElement)) return;

  item.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
}
