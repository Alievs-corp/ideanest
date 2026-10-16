'use client';

import { Pill } from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';

export interface ConfirmDialogProps {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly busyLabel: string;
  readonly cancelLabel: string;
  readonly busy: boolean;
  /** A refusal from the service. Keeps the dialog open — nothing has changed. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/**
 * "Are you sure?" for a console write that takes something away — a role withdrawn, a
 * partnership ended.
 *
 * <p><strong>Its own module, and fetched when it opens.</strong> `Modal` brings the motion
 * library with it, about 120 KiB, and `/admin/staff` and `/admin/partners` had no modal
 * before #501: imported directly it put both routes far over their First Load JS budget.
 * The screens load this with `React.lazy`, as `SupportConsole` loads its forms.
 *
 * <p>Backdrop dismissal is off — the reader has to choose — and Escape stays on, because
 * cancelling is one of the two choices.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busyLabel,
  cancelLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      size="sm"
      title={title}
      closeOnBackdropClick={false}
      showClose={false}
      footer={
        <>
          <Pill variant="ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Pill>
          <Pill variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? busyLabel : confirmLabel}
          </Pill>
        </>
      }
    >
      <p>{body}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
