'use client';

import { useState } from 'react';
import { CharacterCount, Field, Pill, Textarea } from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';
import { REASON_MAX_CHARACTERS, banUser, type AdminUser } from '../../lib/admin/api';
import { suspensionMessageFor } from '../../lib/admin/suspension';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { SuspensionCopy } from '../../lib/i18n/admin/people-copy';

export interface SuspendDialogProps {
  readonly account: AdminUser;
  readonly copy: SuspensionCopy;
  /** What the reader was trying to change, for the shared refusals. */
  readonly subject: string;
  readonly onClose: () => void;
  /** The service's own version of the account, once it has been stopped. */
  readonly onSuspended: (updated: AdminUser) => void;
}

/**
 * The confirmation a suspension goes through, wherever it is started — #104, and #404's account
 * screen since #501.
 *
 * <p><strong>One dialog, so there is one path.</strong> The account screen once argued against
 * offering a suspension at all, because a second control would be "the one without the dialog".
 * It is the same dialog, the same required reason and the same refusals, drawn from one
 * component — so a moderator who has read the account no longer has to go back to the
 * directory, search for the person again and find the row.
 *
 * <p>NOT OPTIMISTIC, for the reason the directory gives: it signs somebody out of every device,
 * and a row that flips before the service answers lies about that for a few hundred
 * milliseconds. Everything that fails keeps the dialog open with the reason still in it —
 * nothing changed, and retyping it is the last thing a refused moderator should do.
 */
export function SuspendDialog({ account, copy, subject, onClose, onSuspended }: SuspendDialogProps) {
  const locale = useRouteLocale();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit(): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed === '') {
      setError(copy.reasonRequired);
      return;
    }
    if (Array.from(reason).length > REASON_MAX_CHARACTERS) {
      setError(fillPlaceholders(copy.reasonTooLong, { limit: String(REASON_MAX_CHARACTERS) }));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      onSuspended(await banUser(account.id, trimmed));
    } catch (cause) {
      setError(suspensionMessageFor(cause, subject, copy));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      size="md"
      title={fillPlaceholders(copy.suspendTitle, { name: account.name })}
      description={fillPlaceholders(copy.suspendDescription, { email: account.email })}
      closeOnBackdropClick={false}
      showClose={false}
      footer={
        <>
          <Pill variant="ghost" disabled={busy} onClick={onClose}>
            {copy.cancel}
          </Pill>
          <Pill variant="danger" disabled={busy} onClick={() => void commit()}>
            {busy ? copy.suspending : copy.suspendAccount}
          </Pill>
        </>
      }
    >
      <p className="text-sm text-on-white/72">{copy.suspendBody}</p>

      <div className="mt-4">
        <Field label={copy.reasonLabel} required hint={copy.reasonHint} error={error}>
          {/* No `maxLength`: a hard cap silently truncates a pasted reason and takes the
              counter's one useful message away. */}
          <Textarea
            rows={4}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <CharacterCount
          count={Array.from(reason).length}
          limit={REASON_MAX_CHARACTERS}
          copy={copy.counter}
          locale={locale}
          className="mt-1"
        />
      </div>
    </Modal>
  );
}
