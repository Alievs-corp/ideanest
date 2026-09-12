import { useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
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

  useEffect(() => {
    if (forceScrolled !== undefined) {
      setScrolled(forceScrolled);
      return;
    }
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold, forceScrolled]);

  return (
    <header
      data-scrolled={scrolled ? '' : undefined}
      className={cn('sticky top-0 z-50 w-full bg-transparent', className)}
      {...props}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-4',
          'transition-[padding] duration-300 ease-in-out',
          scrolled ? 'px-[26px] py-5' : 'px-7 pt-7 pb-3',
        )}
      >
        {logo}

        {nav && (
          <div
            className={cn(
              'flex h-10 items-center justify-around gap-10 rounded-full px-8',
              'transition-[max-width,background-color,border-color] duration-300 ease-in-out',
              scrolled
                ? 'mx-auto max-w-[445px] border border-white/8 bg-white text-on-white'
                : 'max-w-full border border-transparent bg-transparent text-white',
              navClassName,
            )}
          >
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
