import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { IconButton } from '../IconButton/IconButton';
import { Pill } from '../Pill/Pill';
import { useOverlayEntry } from './overlayMotion';

/**
 * Transient message. See docs/ui-kit.md §7.14.
 *
 * Three rules, all of them about not taking control away from the user:
 *
 * 1. **A toast never takes focus.** It is announced through a live region
 *    instead. Moving focus to a message the user did not ask for interrupts
 *    typing, loses the caret, and on a payment form can mean losing a field.
 * 2. **A toast that carries an action never auto-dismisses.** "Undo" that
 *    disappears after five seconds is a promise the interface does not keep.
 * 3. **The timer pauses on hover and on focus-within.** Somebody reading the
 *    message, or tabbing towards its action, is not somebody who is finished
 *    with it.
 *
 * Colour never carries the meaning alone — each variant pairs a token with an
 * icon (docs/ui-kit.md §9.2).
 */

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** A single action. Its presence disables auto-dismiss. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds. Ignored when the toast carries an action. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

export interface ToastContextValue {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside a <ToastProvider>');
  return value;
}

const VARIANT_ICON: Record<ToastVariant, ReactNode> = {
  info: <Info />,
  success: <CircleCheck />,
  warning: <TriangleAlert />,
  // A failed charge is the one message that must not be missed.
  error: <CircleAlert />,
};

const VARIANT_TONE: Record<ToastVariant, string> = {
  info: 'text-info',
  // Success, not lime: lime means "act now", never "done" (docs/ui-kit.md §8.1).
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
};

export interface ToastProviderProps {
  children?: ReactNode;
  /** Default auto-dismiss delay in milliseconds. */
  duration?: number;
}

export function ToastProvider({ children, duration = 5000 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    const id = `toast-${nextId.current}`;
    setToasts((current) => [...current, { ...options, id }]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  // Two live regions, both mounted for the lifetime of the provider. A region
  // inserted at the same moment as its content is frequently not announced at
  // all, so they exist empty and wait.
  const polite = toasts.filter((entry) => entry.variant !== 'error');
  const assertive = toasts.filter((entry) => entry.variant === 'error');

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-end gap-2 p-4 sm:inset-x-auto sm:right-0">
            <div
              role="status"
              aria-live="polite"
              className="flex w-full flex-col items-end gap-2 sm:w-auto"
            >
              {polite.map((entry) => (
                <ToastItem key={entry.id} toast={entry} duration={duration} onDismiss={dismiss} />
              ))}
            </div>
            <div
              role="alert"
              aria-live="assertive"
              className="flex w-full flex-col items-end gap-2 sm:w-auto"
            >
              {assertive.map((entry) => (
                <ToastItem key={entry.id} toast={entry} duration={duration} onDismiss={dismiss} />
              ))}
            </div>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  toast: ToastRecord;
  duration: number;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, duration, onDismiss }: ToastItemProps) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const entry = useOverlayEntry({ opacity: 0, y: 12 });

  const variant = toast.variant ?? 'info';
  const delay = toast.duration ?? duration;

  // Reduced motion is also a request for a slower interface, not only a
  // stiller one — vestibular and cognitive needs overlap. Something that
  // removes itself on a timer is exactly what that setting asks us not to do.
  const autoDismiss = !toast.action && !reduced && delay > 0;

  const { id } = toast;
  useEffect(() => {
    if (!autoDismiss || paused) return;
    const timer = setTimeout(() => onDismiss(id), delay);
    return () => clearTimeout(timer);
    // Unpausing restarts the full delay rather than resuming the remainder:
    // after a pointer leaves, the user gets the whole reading window again.
  }, [autoDismiss, paused, delay, id, onDismiss]);

  return (
    <motion.div
      data-variant={variant}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      // React's onFocus/onBlur bubble, so these are focus-within.
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 sm:w-[380px]',
        'rounded-md border border-fg/8 bg-surface-3 p-4 text-fg',
      )}
      {...entry}
    >
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-[18px]', VARIANT_TONE[variant])}>
        {VARIANT_ICON[variant]}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description && <p className="mt-1 text-sm text-fg-64">{toast.description}</p>}
        {toast.action && (
          <Pill
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => {
              toast.action?.onClick();
              onDismiss(id);
            }}
          >
            {toast.action.label}
          </Pill>
        )}
      </div>

      <IconButton
        icon={<X />}
        label="Dismiss notification"
        variant="ghost"
        size="sm"
        className="-mt-1 -mr-1 shrink-0"
        onClick={() => onDismiss(id)}
      />
    </motion.div>
  );
}
