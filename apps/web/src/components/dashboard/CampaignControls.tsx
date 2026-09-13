'use client';

import { useState } from 'react';
import { CalendarPlus, Landmark } from 'lucide-react';
import { Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import type { CampaignControlsCopy } from '../../lib/i18n/campaign-controls-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { extendProject, withdrawProject } from '../../lib/projects/api';
import type { ProjectState } from '../../lib/projects/api';

/**
 * The creator's two decisions under IDN-EXT-01 §5.1 — issue #44.
 *
 * <h2>What is offered, and who decides</h2>
 *
 * **Withdraw** at 80% or more, from a campaign that is live, in its closing week, extended or
 * successful. **Extend**, once, while the campaign still takes pledges and has raised at least
 * 50%, to a date no later than sixty days after the first deadline. Those are the rules the
 * controls are drawn from, but the service is what applies them: the window around the first
 * deadline is not something this panel can see, so a refusal comes back with a reason and is
 * worded here rather than guessed at beforehand.
 *
 * <h2>Asked inline, not in a dialog</h2>
 *
 * For `ReviewPanel`'s measured reason: `Modal` brings 116 KiB of animation runtime, and the
 * dashboard's budget is "minimal" (docs/motion-system.md §5). Each action is two presses, the
 * consequences are stated between them, and focus lands on the confirming control.
 *
 * <h2>Colour</h2>
 *
 * Outline controls until the second press, whose button is the one lime element — lime is "act
 * now" (docs/ui-kit.md §2.4), and a confirmation is the moment that means it.
 */

/** The states a creator can withdraw from (the service's `WithdrawalNotAvailableException`). */
const WITHDRAWABLE: ReadonlySet<ProjectState> = new Set(['LIVE', 'CLOSING_WINDOW', 'EXTENDED', 'SUCCESSFUL']);

/** The states a campaign takes pledges in and has not been extended from. */
const EXTENDABLE: ReadonlySet<ProjectState> = new Set(['LIVE', 'CLOSING_WINDOW']);

const WITHDRAW_AT_PERCENT = 80;
const EXTEND_AT_PERCENT = 50;
const MAX_EXTENSION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

type Mode = 'idle' | 'confirm-extend' | 'confirm-withdraw';

export interface CampaignControlsProps {
  readonly projectId: string;
  readonly state: ProjectState;
  readonly percentFunded: number | null | undefined;
  /** The current deadline. For a campaign that can still be extended, it is the first one. */
  readonly deadline: string | null | undefined;
  readonly copy: CampaignControlsCopy;
  readonly locale: string;
  /** Called after a change the service accepted, so the figures above are read again. */
  readonly onChanged: () => void;
  readonly extend?: typeof extendProject;
  readonly withdraw?: typeof withdrawProject;
}

export function CampaignControls({
  projectId,
  state,
  percentFunded,
  deadline,
  copy,
  locale,
  onChanged,
  extend = extendProject,
  withdraw = withdrawProject,
}: CampaignControlsProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [day, setDay] = useState('');

  const percent = percentFunded ?? 0;
  const window = extensionWindow(deadline);
  const canWithdraw = WITHDRAWABLE.has(state) && percent >= WITHDRAW_AT_PERCENT;
  const belowThreshold = WITHDRAWABLE.has(state) && percent < WITHDRAW_AT_PERCENT;
  const canExtend = EXTENDABLE.has(state) && percent >= EXTEND_AT_PERCENT && window !== null;

  if (!WITHDRAWABLE.has(state) && notice === null) return null;

  const latest = window === null ? '' : formatDay(window.latestDay, locale);
  const chosen = day === '' ? '' : formatDay(day, locale);

  function start(next: Mode) {
    setError(null);
    if (next === 'confirm-extend') {
      if (window === null || day === '' || day <= window.deadlineDay || day > window.latestDay) {
        setError(fillPlaceholders(copy.extendDate, { latest }));
        return;
      }
    }
    setMode(next);
  }

  async function run(action: 'extend' | 'withdraw') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'extend' && window !== null) {
        await extend(projectId, `${day}${window.timeOfDay}`);
        setNotice(fillPlaceholders(copy.extended, { date: chosen }));
      } else {
        await withdraw(projectId);
        setNotice(copy.withdrawn);
      }
      setMode('idle');
      onChanged();
    } catch (cause) {
      setError(refusalFor(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="campaign-controls-heading" className="mt-8 rounded-[16px] border border-white/8 p-5">
      <h2 id="campaign-controls-heading" className="text-sm font-semibold text-white">
        {copy.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.rule}</p>

      {notice !== null && (
        <div className="mt-4">
          <InlineAlert variant="success">
            <p>{notice}</p>
          </InlineAlert>
        </div>
      )}

      {error !== null && (
        <div className="mt-4">
          <InlineAlert variant="danger">{error}</InlineAlert>
        </div>
      )}

      {mode === 'confirm-extend' && (
        <Confirmation
          id="campaign-extend-confirm"
          title={fillPlaceholders(copy.extendConfirmTitle, { date: chosen })}
          body={copy.extendConfirmBody}
          action={busy ? copy.extending : copy.extendNow}
          cancel={copy.cancel}
          busy={busy}
          onConfirm={() => void run('extend')}
          onCancel={() => setMode('idle')}
        />
      )}

      {mode === 'confirm-withdraw' && (
        <Confirmation
          id="campaign-withdraw-confirm"
          title={copy.withdrawConfirmTitle}
          body={copy.withdrawConfirmBody}
          action={busy ? copy.withdrawing : copy.withdrawNow}
          cancel={copy.cancel}
          busy={busy}
          onConfirm={() => void run('withdraw')}
          onCancel={() => setMode('idle')}
        />
      )}

      {mode === 'idle' && notice === null && (
        <div className="mt-5 flex flex-col gap-5">
          {canExtend && window !== null && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label={copy.extendLabel} hint={fillPlaceholders(copy.extendHint, { latest })}>
                <TextInput
                  type="date"
                  value={day}
                  min={window.firstDay}
                  max={window.latestDay}
                  onChange={(event) => setDay(event.currentTarget.value)}
                />
              </Field>
              <Pill variant="outline" onClick={() => start('confirm-extend')}>
                <CalendarPlus className="size-4" aria-hidden />
                {copy.extend}
              </Pill>
            </div>
          )}

          {canWithdraw && (
            <div>
              <Pill variant="outline" onClick={() => start('confirm-withdraw')}>
                <Landmark className="size-4" aria-hidden />
                {copy.withdraw}
              </Pill>
            </div>
          )}

          {belowThreshold && <p className="text-sm text-white/64">{copy.belowThreshold}</p>}
        </div>
      )}
    </section>
  );
}

function Confirmation({
  id,
  title,
  body,
  action,
  cancel,
  busy,
  onConfirm,
  onCancel,
}: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly cancel: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div role="group" aria-labelledby={`${id}-heading`} className="mt-5 rounded-2xl border border-white/8 bg-surface-2 p-5">
      <h3 id={`${id}-heading`} className="text-[15px] font-medium text-white">
        {title}
      </h3>
      <p className="mt-2 text-[13px] text-white/64">{body}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Pill
          variant="accent"
          autoFocus
          aria-disabled={busy}
          className={busy ? 'opacity-40' : undefined}
          onClick={() => {
            if (!busy) onConfirm();
          }}
        >
          {action}
        </Pill>
        <Pill
          variant="ghost"
          aria-disabled={busy}
          onClick={() => {
            if (!busy) onCancel();
          }}
        >
          {cancel}
        </Pill>
      </div>
    </div>
  );
}

/**
 * The days an extension may end on, in UTC calendar days, and the deadline's time of day.
 *
 * The new deadline keeps the current one's time of day, so "extend to 1 October" means the same
 * hour the campaign was going to close at, and the last allowed day is exactly sixty days after
 * the first deadline — the service's own bound, so the latest day offered is one it accepts.
 */
export function extensionWindow(deadline: string | null | undefined) {
  if (deadline == null) return null;
  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;
  const iso = new Date(at).toISOString();
  return {
    deadlineDay: iso.slice(0, 10),
    firstDay: new Date(at + DAY_MS).toISOString().slice(0, 10),
    latestDay: new Date(at + MAX_EXTENSION_DAYS * DAY_MS).toISOString().slice(0, 10),
    timeOfDay: iso.slice(10),
  };
}

function formatDay(day: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
  } catch {
    return day;
  }
}

/** The service's reason, in words. A refusal without one is the generic failure, not a guess. */
function refusalFor(cause: unknown, copy: CampaignControlsCopy): string {
  if (!(cause instanceof ApiError) || cause.problem === null) return copy.failed;
  const code = cause.problem.code;
  const meta = (cause.problem as { meta?: { reason?: unknown } }).meta;
  const reason = typeof meta?.reason === 'string' ? meta.reason : null;
  if (code === 'EXTENSION_NOT_AVAILABLE') {
    switch (reason) {
      case 'ALREADY_EXTENDED':
        return copy.extendAlready;
      case 'OUTSIDE_WINDOW':
        return copy.extendOutsideWindow;
      case 'BELOW_THRESHOLD':
        return copy.extendBelow;
      default:
        return copy.extendWrongState;
    }
  }
  if (code === 'WITHDRAWAL_NOT_AVAILABLE') {
    return reason === 'BELOW_THRESHOLD' ? copy.belowThreshold : copy.withdrawWrongState;
  }
  return copy.failed;
}
