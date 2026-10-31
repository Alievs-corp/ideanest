'use client';

import { useState } from 'react';
import { CalendarPlus, Landmark } from 'lucide-react';
import { Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import {
  controlsOffer,
  extensionUntil,
  extensionWindow,
  isExtensionDay,
  refusalOf,
} from '@ideanest/dashboard/controls';
import { ApiError } from '../../lib/api/problem';
import type { CampaignControlsCopy } from '../../lib/i18n/campaign-controls-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { dateTimeFormat } from '../../lib/i18n/formats';
import { DEFAULT_LOCALE, isLocale } from '../../lib/i18n/locale';
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
 * deadline is drawn from the deadline and the current time (#619): before it opens the panel names
 * the day it does instead of offering a field the service would refuse, and any refusal still
 * comes back with a reason and is worded here rather than guessed at beforehand.
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
 *
 * <p>Which controls are offered, the date bounds and the wording of a refusal are
 * `@ideanest/dashboard/controls`, shared with the app since #163.
 */

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
  /**
   * The current instant in epoch milliseconds, already corrected by the skew measured against
   * the dashboard's `serverTime` — what decides whether the extension window is open.
   */
  readonly now?: () => number;
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
  now = Date.now,
  extend = extendProject,
  withdraw = withdrawProject,
}: CampaignControlsProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [day, setDay] = useState('');

  const window = extensionWindow(deadline);
  const { shown, canExtend, canWithdraw, belowThreshold, extendOpensAt } = controlsOffer(
    state,
    percentFunded,
    deadline,
    now(),
  );

  if (!shown && notice === null) return null;

  const latest = window === null ? '' : formatDay(window.latestDay, locale);
  const chosen = day === '' ? '' : formatDay(day, locale);

  function start(next: Mode) {
    setError(null);
    if (next === 'confirm-extend') {
      if (!isExtensionDay(day, window)) {
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
        await extend(projectId, extensionUntil(day, window));
        setNotice(fillPlaceholders(copy.extended, { date: chosen }));
      } else {
        await withdraw(projectId);
        setNotice(copy.withdrawn);
      }
      setMode('idle');
      onChanged();
    } catch (cause) {
      setError(refusalFor(cause, copy, latest));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="campaign-controls-heading" className="mt-8 rounded-[16px] border border-fg/8 p-5">
      <h2 id="campaign-controls-heading" className="text-sm font-semibold text-fg">
        {copy.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.rule}</p>

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
            // The action shares the input's row inside the field, so it lines up with the input
            // rather than with the input and its hint together.
            <Field label={copy.extendLabel} hint={fillPlaceholders(copy.extendHint, { latest })}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 sm:max-w-md sm:flex-1">
                  <TextInput
                    type="date"
                    value={day}
                    min={window.firstDay}
                    max={window.latestDay}
                    onChange={(event) => setDay(event.currentTarget.value)}
                  />
                </div>
                <Pill variant="outline" className="self-start sm:self-auto" onClick={() => start('confirm-extend')}>
                  <CalendarPlus className="size-4" aria-hidden />
                  {copy.extend}
                </Pill>
              </div>
            </Field>
          )}

          {extendOpensAt !== null && (
            <p className="text-sm text-fg-64">
              {fillPlaceholders(copy.extendOpensOn, { date: formatDay(extendOpensAt.slice(0, 10), locale) })}
            </p>
          )}

          {canWithdraw && (
            <div>
              <Pill variant="outline" onClick={() => start('confirm-withdraw')}>
                <Landmark className="size-4" aria-hidden />
                {copy.withdraw}
              </Pill>
            </div>
          )}

          {belowThreshold && <p className="text-sm text-fg-64">{copy.belowThreshold}</p>}
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
    <div role="group" aria-labelledby={`${id}-heading`} className="mt-5 rounded-2xl border border-fg/8 bg-surface-2 p-5">
      <h3 id={`${id}-heading`} className="text-[15px] font-medium text-fg">
        {title}
      </h3>
      <p className="mt-2 text-[13px] text-fg-64">{body}</p>
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
 * A calendar day in the reader's language. Through the shared formatter, not `Intl` directly:
 * browsers ship no Azerbaijani month names, and a bare `Intl.DateTimeFormat('az')` printed
 * "2027 M01 14".
 */
function formatDay(day: string, locale: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  return dateTimeFormat(
    isLocale(locale) ? locale : DEFAULT_LOCALE,
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' },
    'extend-day',
  ).format(at);
}

/** The service's reason, in words. A refusal without one is the generic failure, not a guess. */
function refusalFor(cause: unknown, copy: CampaignControlsCopy, latest: string): string {
  const key = refusalOf(cause instanceof ApiError ? cause.problem : null);
  return key === 'extendDate' ? fillPlaceholders(copy.extendDate, { latest }) : copy[key];
}
