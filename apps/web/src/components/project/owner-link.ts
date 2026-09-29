/**
 * How a creator's own management links look — issue #141.
 *
 * <p>A link and not a `Pill`: `Pill` is a `<button>`, and wrapping one in an anchor puts one
 * interactive element inside another. The outline treatment is `CategoryLanding`'s chip, the
 * quiet secondary action every dark surface on the site already uses, so the owner's links read
 * as tools beside the page rather than as calls to action competing with the pledge button.
 */
export const OWNER_LINK_CLASS = [
  'inline-flex h-9 shrink-0 items-center rounded-full border border-white/8 bg-surface-2 px-4',
  'text-sm text-white/64 transition-colors duration-150 ease-in-out',
  'hover:bg-surface-3 hover:text-white',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
].join(' ');
