import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { useCallback, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { IconButton } from '../IconButton/IconButton';
import { Backdrop } from './Backdrop';
import { useOverlayEntry } from './overlayMotion';
import { useDismiss, useScrollLock } from './useDismiss';
import { useFocusTrap } from './useFocusTrap';

/**
 * Centre-stage dialog. See docs/ui-kit.md §7.14.
 *
 * The modal is the one component in a dark system that is WHITE. Depth here is
 * surface colour, not shadow (§3), and a modal is the only thing genuinely
 * above the plane — so it takes the floating-panel treatment (§7.9) and the
 * only shadow the system allows. Everything else that overlays the page
 * (drawer, popover, tooltip, toast) stays dark, because it belongs to the page
 * rather than interrupting it.
 *
 * Text inside is near-black. `text-white/64` is invisible here; use
 * `text-on-white/64`.
 *
 * Controlled only. There is no uncontrolled mode: whether a payment dialog is
 * open is application state, and a component that owns it privately makes the
 * one case that matters — reopening after a failed charge — impossible.
 */
const modalPanel = cva(
  [
    'relative w-full overflow-hidden rounded-xl',
    'bg-white text-on-white shadow-float',
    'max-h-[calc(100vh-2rem)] overflow-y-auto',
  ],
  {
    variants: {
      size: {
        sm: 'max-w-[380px]',
        md: 'max-w-[520px]',
        lg: 'max-w-[720px]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface ModalProps
  extends Omit<HTMLMotionProps<'div'>, 'title' | 'ref' | 'children'>,
    VariantProps<typeof modalPanel> {
  children?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required — it is the dialog's accessible name. */
  title: ReactNode;
  /** Optional supporting line, wired to `aria-describedby`. */
  description?: ReactNode;
  /** Footer row, usually the confirm and cancel actions. */
  footer?: ReactNode;
  /** Set false when the user must make a choice before continuing. */
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  /** Hide the corner close control when the footer already carries a cancel. */
  showClose?: boolean;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showClose = true,
  className,
  children,
  ...props
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useDismiss({ open, onDismiss: close, closeOnEscape });
  useScrollLock(open);
  useFocusTrap(open, panelRef);
  const entry = useOverlayEntry({ opacity: 0, y: 24 });

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <Backdrop dismissible={closeOnBackdropClick} onDismiss={close} />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        // Focusable so a dialog with no controls still receives focus rather
        // than leaving it stranded on the page behind.
        tabIndex={-1}
        // Tells what sits inside that it is on white: `Pill`'s primary inverts
        // and the focus ring turns near-black (theme.css).
        data-on-white=""
        className={cn(modalPanel({ size }), className)}
        {...entry}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div>
            <h2 id={titleId} className="text-lg font-medium tracking-[-0.02em]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-on-white/64">
                {description}
              </p>
            )}
          </div>
          {showClose && (
            <IconButton
              icon={<X />}
              label="Close"
              variant="ghost"
              size="sm"
              className="-mr-1 shrink-0 text-on-white/64 hover:bg-black/6 hover:text-on-white"
              onClick={close}
            />
          )}
        </div>

        <div className="px-6 pb-6 text-sm text-on-white/64">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-black/8 px-6 py-4">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
