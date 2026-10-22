/**
 * The first focusable element in the document — §4.13 WS-01, docs/ui-kit.md §8.6.
 *
 * NOT OPTIONAL, AND PART OF THE SHELL RATHER THAN OF A PAGE. §8.6 is explicit: without one,
 * every page on the platform starts with the same dozen links for anybody navigating by
 * keyboard, and the cost is paid again on every route. It is paid once here.
 *
 * VISUALLY HIDDEN UNTIL FOCUSED, never `display: none`. A hidden element is not focusable,
 * so a skip link implemented that way is a skip link that cannot be reached by the one input
 * device it exists for. It is positioned off the top of the viewport instead and comes back
 * on focus.
 *
 * `sr-only` FROM TAILWIND IS NOT ENOUGH ON ITS OWN and is not used: it clips the element to
 * a single pixel, which is correct for text nobody sees and wrong for a control that has to
 * become visible. The pair below is the standard one — off-screen, then in place — and it
 * animates nothing. docs/motion-system.md §5 gives the shell one animation and it is the
 * header's collapse.
 *
 * The target is the `<main>` the site layout renders, which carries `tabIndex={-1}` so the
 * browser will actually move focus into it rather than only scrolling to it.
 *
 * ITS WORD ARRIVES AS A PROP, like the rest of the shell's. Reading the catalogue here would
 * make this an async component, and an async component cannot be rendered by a synchronous
 * parent — which is what `MinimalShell`, `SiteShell` and `AdminArea` all are at the point
 * they place it. The rule the shell follows is that the frame resolves and the leaves are
 * handed words; this is a leaf.
 */
export const MAIN_CONTENT_ID = 'main-content';

export interface SkipLinkProps {
  /** "Skip to content", in the reader's language. Resolved by whichever frame renders this. */
  readonly label: string;
}

export function SkipLink({ label }: SkipLinkProps) {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className={[
        'absolute left-4 top-4 z-[100] -translate-y-[200%]',
        'rounded-full bg-inverse px-5 py-2.5 text-sm font-medium text-on-inverse',
        'focus:translate-y-0',
        // Focus is visible on every interactive element (ui-kit §9.3), including this one,
        // which is the only element on the page whose entire purpose is being focused.
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
      ].join(' ')}
    >
      {label}
    </a>
  );
}
