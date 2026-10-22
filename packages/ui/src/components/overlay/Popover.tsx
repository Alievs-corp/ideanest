import { motion, type HTMLMotionProps } from 'motion/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useOverlayEntry } from './overlayMotion';
import { rectOf, resolvePlacement, type Placement, type Position } from './placement';
import { useDismiss } from './useDismiss';
import { useFocusTrap } from './useFocusTrap';

/**
 * Anchored panel that does NOT block the page. See docs/ui-kit.md §7.14.
 *
 * Non-modal on purpose: a popover is a side note attached to a control — a
 * sort menu, a fee breakdown — and the page behind it stays live, scrollable
 * and reachable by Tab. That is the whole difference from `Modal`, and it is
 * why there is no backdrop, no scroll lock and no focus trap here. Focus still
 * MOVES into the panel on open and returns to the anchor on close, or a
 * keyboard user would have to Tab through the rest of the page to reach the
 * thing they just opened.
 *
 * Dark surface: only the modal is white (§3).
 */
export interface PopoverProps extends Omit<HTMLMotionProps<'div'>, 'title' | 'ref' | 'children'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control the panel is anchored to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Preferred side. Flips to the opposite one when it does not fit. */
  placement?: Placement;
  /** Accessible name for the panel. */
  label?: string;
  children?: ReactNode;
}

export function Popover({
  open,
  onOpenChange,
  anchorRef,
  placement = 'bottom',
  label,
  className,
  children,
  ...props
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useDismiss({ open, onDismiss: close });
  useFocusTrap(open, panelRef, { trap: false });
  const entry = useOverlayEntry({ opacity: 0, y: 4 });

  // Layout effect so the panel is placed in the same frame it appears in;
  // measuring in a passive effect paints it at the top-left corner first.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    function update() {
      if (!anchor || !panel) return;
      setPosition(
        resolvePlacement(
          rectOf(anchor),
          rectOf(panel),
          { width: window.innerWidth, height: window.innerHeight },
          placement,
        ),
      );
    }

    update();
    window.addEventListener('resize', update);
    // Capture phase: a popover anchored inside a scrolling rail has to follow
    // that rail, and scroll does not bubble.
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, placement, anchorRef]);

  // Non-modal, so the page is still clickable — a press outside is the normal
  // way to put the panel away. `pointerdown`, not `click`: a press that lands
  // on the page should dismiss immediately rather than on release.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      close();
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      data-placement={position?.placement ?? placement}
      tabIndex={-1}
      style={{ position: 'fixed', top: position?.top ?? 0, left: position?.left ?? 0 }}
      className={cn(
        'z-50 max-w-[320px] rounded-md border border-fg/8 bg-surface-3 p-4',
        'text-sm text-fg-64',
        className,
      )}
      {...entry}
      {...props}
    >
      {children}
    </motion.div>,
    document.body,
  );
}
