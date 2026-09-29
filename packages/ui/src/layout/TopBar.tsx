import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn';

/**
 * Collapsing top navigation. See docs/ui-kit.md §8.6 and docs/motion-system.md §4.7.
 *
 * Three things change together on scroll — width narrows, the pill picks up a
 * white surface, padding tightens — all on the same 300ms curve. The effect is
 * that navigation is absent at the top of the page and materialises as you move.
 *
 * `position: sticky` is used rather than `fixed` so the bar participates in
 * layout and never covers the first focusable element.
 *
 * ONLY `transform` AND `opacity` MOVE — issue 166. This bar used to transition the
 * row's `padding` and the pill's `max-width`, which laid out every page again on
 * every frame of the collapse, on every scroll. The layout now changes in one step
 * and the motion is drawn over it:
 *
 * - The white surface is a layer of its own behind the links, and it fades in with
 *   `opacity`. The pill keeps a transparent 1px border in both states, so its size
 *   does not depend on the surface.
 * - The row's children move by FLIP: where each one is drawn is read just before the
 *   change, the new layout is applied, and each child starts from where it was with a
 *   `transform` that runs out to nothing over 300ms. The end state is the same markup
 *   it always was, so the collapsed header looks exactly as it did.
 *
 * The FLIP transform exists only while it runs. A transform left on the row at rest
 * would make it the containing block of every `position: fixed` descendant, and the
 * web app's mobile drawer is one: it would open inside the header, not over the page.
 *
 * Reduced motion: the surface's transition is removed with `motion-reduce:`, and the
 * FLIP is not started at all, because a Web Animation does not read the stylesheet's
 * reduced-motion rule the way a CSS transition does.
 */
export interface TopBarProps extends ComponentPropsWithoutRef<'header'> {
  /** Left slot — usually a wordmark. */
  logo?: ReactNode;
  /** Centre slot — the pill that collapses. */
  nav?: ReactNode;
  /**
   * On the pill itself, for a consumer whose navigation is not drawn at every width.
   *
   * The pill is a surface and a pair of 32px gutters, and both are paid whether or not
   * anything inside it is displayed: a consumer that hid its own links with `hidden md:flex`
   * was left with an empty white oval on a phone, holding 66px of a 390px row open. Hiding
   * the pill is the consumer's decision to make — some navigation belongs on a phone — so it
   * is a class rather than a breakpoint this component picks.
   */
  navClassName?: string;
  /** Right slot — actions. */
  actions?: ReactNode;
  /** Scroll offset in pixels at which the collapsed state engages. */
  threshold?: number;
  /**
   * Force the collapsed state. Useful in Storybook and for pages that never
   * scroll but still want the compact treatment.
   */
  forceScrolled?: boolean;
}

/** docs/motion-system.md §4.7: one 300ms curve for everything that changes. */
const COLLAPSE_MS = 300;
/** `--ease-standard`, the curve Tailwind's `ease-in-out` resolves to in this kit. */
const COLLAPSE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Where each of the row's children is drawn, including any transform still running. */
function measure(row: HTMLElement | null): DOMRect[] | null {
  return row ? Array.from(row.children, (child) => child.getBoundingClientRect()) : null;
}

export function TopBar({
  logo,
  nav,
  navClassName,
  actions,
  threshold = 24,
  forceScrolled,
  className,
  ...props
}: TopBarProps) {
  const [scrolled, setScrolled] = useState(forceScrolled ?? false);
  const rowRef = useRef<HTMLDivElement>(null);
  /** The state on screen, readable from the scroll listener without re-subscribing. */
  const shown = useRef(scrolled);
  /** The row's children as drawn just before the state changed: FLIP's "first". */
  const first = useRef<DOMRect[] | null>(null);

  const show = useCallback((next: boolean) => {
    if (next === shown.current) return;
    first.current = prefersReducedMotion() ? null : measure(rowRef.current);
    shown.current = next;
    setScrolled(next);
  }, []);

  useEffect(() => {
    if (forceScrolled !== undefined) {
      show(forceScrolled);
      return;
    }
    const onScroll = () => show(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold, forceScrolled, show]);

  /*
   * FLIP's "last, invert, play". A layout effect runs before paint, so the new layout is
   * never drawn without the transform that puts each child back where it was.
   */
  useLayoutEffect(() => {
    const before = first.current;
    first.current = null;
    const row = rowRef.current;
    if (!before || !row || row.children.length !== before.length) return;

    Array.from(row.children).forEach((child, index) => {
      const was = before[index];
      if (!was || !(child instanceof HTMLElement) || typeof child.animate !== 'function') return;

      const now = child.getBoundingClientRect();
      // Centres rather than edges, so a pill whose width changed moves as one piece.
      const dx = was.left + was.width / 2 - (now.left + now.width / 2);
      const dy = was.top + was.height / 2 - (now.top + now.height / 2);
      if (dx === 0 && dy === 0) return;

      child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: COLLAPSE_MS,
        easing: COLLAPSE_EASING,
      });
    });
  }, [scrolled]);

  return (
    <header
      data-scrolled={scrolled ? '' : undefined}
      className={cn('sticky top-0 z-50 w-full bg-transparent', className)}
      {...props}
    >
      <div
        ref={rowRef}
        className={cn(
          'flex items-center justify-between gap-4',
          /*
           * 20px at the sides below `sm`, the same gutter the page content uses there, so
           * the wordmark lines up with the text under it. The 28px it had was 16px of a
           * phone's row spent on nothing, and the row has none to spare: the web header's
           * language control did not fit beside the register pill without it.
           *
           * Nothing transitions here. The padding changes in one step and the FLIP above
           * draws the movement. Both states are 40px of vertical padding, so the bar's
           * height never changes and nothing below it moves.
           */
          scrolled ? 'px-[18px] py-5 sm:px-[26px]' : 'px-5 pt-7 pb-3 sm:px-7',
        )}
      >
        {logo}

        {nav && (
          <div
            className={cn(
              'relative isolate flex h-10 items-center justify-around gap-10 rounded-full border border-transparent px-8',
              scrolled ? 'mx-auto max-w-[445px] text-on-white' : 'max-w-full text-white',
              navClassName,
            )}
          >
            {/*
              The surface, as its own layer, so that materialising is an `opacity` change
              the compositor does alone. `-inset-px` covers the pill's transparent border,
              and the layer draws the 8% white border itself, so the white reaches the same
              edge it did when the pill's own background and border were coloured.
            */}
            <span
              aria-hidden="true"
              data-top-bar-surface=""
              className={cn(
                'pointer-events-none absolute -inset-px -z-10 rounded-full border border-white/8 bg-white',
                'transition-opacity duration-300 ease-in-out motion-reduce:transition-none',
                scrolled ? 'opacity-100' : 'opacity-0',
              )}
            />
            {nav}
          </div>
        )}

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Navigation link that inherits the bar's current text colour. */
export function TopBarLink({ className, ...props }: ComponentPropsWithoutRef<'a'>) {
  return (
    <a
      className={cn(
        'text-sm font-medium tracking-[-0.01em] whitespace-nowrap',
        'opacity-80 transition-opacity duration-150 hover:opacity-100',
        className,
      )}
      {...props}
    />
  );
}
