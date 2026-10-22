import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { useCallback, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { IconButton } from '../IconButton/IconButton';
import { Backdrop } from './Backdrop';
import { useOverlayEntry, type OverlayEntryFrom } from './overlayMotion';
import { useDismiss, useScrollLock } from './useDismiss';
import { useFocusTrap } from './useFocusTrap';

/**
 * Edge-anchored dialog. See docs/ui-kit.md §7.14.
 *
 * Same semantics as `Modal` — `role="dialog"`, `aria-modal`, focus trapped,
 * page scroll locked — but a DARK surface. A drawer is an extension of the
 * page rather than an interruption of it: filters, a cart, a detail pane. Only
 * the modal earns white and a shadow (§3).
 *
 * It slides with `translate`. Animating `right` or `width` would relayout a
 * full-height fixed panel on every frame, and the list inside it reflows with
 * it (docs/motion-system.md §4.11, CLAUDE.md §2).
 */
const drawerPanel = cva(
  ['fixed bg-surface-2 text-fg', 'flex flex-col overflow-hidden', 'border-fg/8'],
  {
    variants: {
      side: {
        right: 'inset-y-0 right-0 h-full w-full max-w-[420px] rounded-l-xl border-l',
        left: 'inset-y-0 left-0 h-full w-full max-w-[420px] rounded-r-xl border-r',
        bottom: 'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-xl border-t',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

/** Travel comes from the panel's own size, so the slide is edge-to-edge. */
const SLIDE_FROM: Record<DrawerSide, OverlayEntryFrom> = {
  right: { x: '100%' },
  left: { x: '-100%' },
  bottom: { y: '100%' },
};

export type DrawerSide = 'right' | 'left' | 'bottom';

export interface DrawerProps extends Omit<HTMLMotionProps<'div'>, 'title' | 'ref' | 'children'> {
  children?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required — it is the dialog's accessible name. */
  title: ReactNode;
  description?: ReactNode;
  /** Which edge the panel is anchored to. */
  side?: DrawerSide;
  footer?: ReactNode;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  side = 'right',
  footer,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className,
  children,
  ...props
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useDismiss({ open, onDismiss: close, closeOnEscape });
  useScrollLock(open);
  useFocusTrap(open, panelRef);
  const entry = useOverlayEntry({ opacity: 1, ...SLIDE_FROM[side] });

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <Backdrop dismissible={closeOnBackdropClick} onDismiss={close} />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-side={side}
        tabIndex={-1}
        className={cn(drawerPanel({ side }), className)}
        {...entry}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
          <div>
            <h2 id={titleId} className="text-lg font-medium tracking-[-0.02em]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-fg-64">
                {description}
              </p>
            )}
          </div>
          <IconButton
            icon={<X />}
            label="Close"
            variant="ghost"
            size="sm"
            className="-mr-1 shrink-0"
            onClick={close}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 text-sm text-fg-64">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-fg/8 px-5 py-4">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
