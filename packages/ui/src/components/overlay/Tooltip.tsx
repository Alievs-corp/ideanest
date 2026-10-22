import { motion } from 'motion/react';
import {
  cloneElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useOverlayEntry } from './overlayMotion';
import { rectOf, resolvePlacement, type Placement, type Position } from './placement';
import { useDismiss } from './useDismiss';

/**
 * A short description of its trigger. See docs/ui-kit.md §7.14.
 *
 * Opens on hover AND on focus. Hover alone is not an implementation shortcut,
 * it is a defect: a keyboard user never produces a hover, so a hover-only
 * tooltip is content that exists for mouse users and for nobody else.
 *
 * Wired with `aria-describedby`, never `aria-label`. `aria-label` REPLACES the
 * trigger's name — "Refund policy" would silently overwrite "Cancel pledge" —
 * whereas `describedby` is announced after it, which is what a tooltip is.
 *
 * Never put interactive content inside one. A tooltip closes on pointer-leave
 * and on blur, so there is no path by which a pointer or a Tab press can reach
 * a control inside it; and assistive technology flattens `aria-describedby` to
 * a text string, which drops the control entirely. If it needs a button, it is
 * a `Popover`.
 */
export interface TooltipProps {
  /** The description. Plain text — see the note about interactive content. */
  label: string;
  /**
   * The trigger. Must render a DOM element and spread its props, because the
   * clone adds `aria-describedby` to it.
   */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  /** Preferred side. Flips to the opposite one when it does not fit. */
  placement?: Placement;
  className?: string;
}

export function Tooltip({ label, children, placement = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  const close = useCallback(() => setOpen(false), []);
  useDismiss({ open, onDismiss: close });

  const entry = useOverlayEntry({ opacity: 0, y: 4 });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;

    setPosition(
      resolvePlacement(
        rectOf(anchor),
        rectOf(tip),
        { width: window.innerWidth, height: window.innerHeight },
        placement,
      ),
    );
  }, [open, placement]);

  const trigger = cloneElement(children, { 'aria-describedby': open ? tooltipId : undefined });

  return (
    <>
      {/* The wrapper is the measurement anchor and carries the open/close
          handlers, so the trigger keeps whatever handlers it already had. */}
      <span
        ref={anchorRef}
        className="inline-flex"
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={close}
        onFocus={() => setOpen(true)}
        onBlur={close}
      >
        {trigger}
      </span>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <motion.div
            ref={tipRef}
            id={tooltipId}
            role="tooltip"
            data-placement={position?.placement ?? placement}
            style={{ position: 'fixed', top: position?.top ?? 0, left: position?.left ?? 0 }}
            className={cn(
              'pointer-events-none z-50 max-w-[240px] rounded-sm px-2.5 py-1.5',
              'border border-fg/8 bg-surface-4 text-xs text-fg',
              className,
            )}
            {...entry}
          >
            {label}
          </motion.div>,
          document.body,
        )}
    </>
  );
}
