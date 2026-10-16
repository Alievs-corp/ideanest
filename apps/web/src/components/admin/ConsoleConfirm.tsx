'use client';

import { Pill } from '@ideanest/ui';

/**
 * The second step of a console control that cannot be taken back: what is about to happen, in a
 * sentence, then the action and the way back. Inline rather than a dialog, because `Modal` costs a
 * console route about 120 KiB of First Load JS.
 */
export function Confirm({
  label,
  text,
  action,
  working,
  back,
  busy,
  onConfirm,
  onBack,
}: {
  readonly label: string;
  readonly text: string;
  readonly action: string;
  readonly working: string;
  readonly back: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onBack: () => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-full flex-col gap-2 rounded-lg border border-white/16 p-3">
      <p className="max-w-[62ch] text-sm text-white">{text}</p>
      <div className="flex flex-wrap gap-2">
        <Pill size="sm" autoFocus aria-disabled={busy} onClick={() => (busy ? undefined : onConfirm())}>
          {busy ? working : action}
        </Pill>
        <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => (busy ? undefined : onBack())}>
          {back}
        </Pill>
      </div>
    </div>
  );
}
