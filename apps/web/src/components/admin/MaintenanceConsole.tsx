'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '../../i18n/navigation';
import {
  Checkbox,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Tag,
  TextInput,
  Textarea,
} from '@ideanest/ui';
import {
  actionsFor,
  cancelWindow,
  changeWindowEnd,
  endWindowNow,
  instantFromLocal,
  localFromInstant,
  MAINTENANCE_STRIP,
  readMaintenance,
  scheduleWindow,
  startWindowNow,
  type MaintenanceWindow,
} from '../../lib/admin/maintenance';
import { ApiError } from '../../lib/api/problem';
import { codedRefusalFor } from '../../lib/admin/coded-refusal';
import { actionMessageFor } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { MaintenanceConsoleCopy } from '../../lib/i18n/admin/platform-copy';
import { formatExactTime } from '../../lib/time';
import { Confirm } from './ConsoleConfirm';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * `/admin/maintenance` — §19.6, issue #214.
 *
 * <h2>Every verb that reaches readers asks first, and the confirmation is inline</h2>
 *
 * Start now and End now take effect for every reader within about half a minute — the
 * service's snapshot and the site's own status cache each hold an answer for a few seconds —
 * so neither is the first press: the consequence is stated, and the button that acts is the
 * second. Cancelling withdraws a notice readers have been shown and cannot be undone, and
 * scheduling a window whose start has already come starts it at once; both ask too. It is a
 * panel in place rather than a dialog, because `Modal` costs a console route about 120 KiB.
 *
 * <h2>A refusal is said where it happened</h2>
 *
 * A refused schedule is said under the form, and a refused verb in the row it was pressed in,
 * in the reader's language by the service's code.
 *
 * <h2>Times are the reader's own</h2>
 *
 * Every time is shown and typed in the browser's zone, which the schedule form names, so a
 * member of staff in Baku types 02:00 and means 02:00 in Baku. What is sent is an instant; the
 * service and every reader convert from there.
 */
export interface MaintenanceConsoleProps {
  readonly copy: MaintenanceConsoleCopy;
}

type Confirming = { readonly id: string; readonly verb: 'start' | 'end' | 'cancel' } | null;

/** Where a refusal is said: under the schedule form, or in the row of the window it was about. */
type Refusal = { readonly where: string; readonly message: string } | null;

const SCHEDULE = 'schedule';

/** The service's own allowance: a start up to this far ahead of now is taken as now. */
const STARTS_NOW_WITHIN_MS = 60_000;

export function MaintenanceConsole({ copy }: MaintenanceConsoleProps) {
  const locale = useRouteLocale();
  const router = useRouter();
  const overview = useConsoleResource((signal) => readMaintenance(signal), copy.subject, copy.refusals, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Refusal>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [changingEnd, setChangingEnd] = useState<string | null>(null);
  const [zone, setZone] = useState('');

  /*
   * The zone is read after mount: the server renders this screen too, and its zone is the
   * container's rather than the reader's.
   */
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '');
    } catch {
      setZone('');
    }
  }, []);

  const inForce = overview.status === 'ready' && overview.data !== null ? overview.data.current !== null : null;
  /*
   * The console shell's "maintenance is on" strip is drawn by the layout, which a client
   * navigation does not redraw: a window that started on its own schedule, or that somebody else
   * started, stayed out of the strip on the very screen that showed it in force. When what this
   * read and what the strip says disagree, the route is redrawn — no script in the layout, so no
   * console route pays for it.
   */
  useEffect(() => {
    if (inForce === null) return;
    const drawn = document.querySelector(`[${MAINTENANCE_STRIP}]`) !== null;
    if (drawn !== inForce) router.refresh();
  }, [inForce, router]);

  if (overview.status === 'signed-out' || overview.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={overview.status}
        capability={overview.capability}
        subject={copy.subject}
        copy={copy.refusals}
      />
    );
  }

  const time = (instant: string) => formatExactTime(instant, locale);

  /** A service refusal in the reader's language, by its code; never the service's English. */
  function messageFor(cause: unknown): string {
    const code = cause instanceof ApiError ? cause.problem?.code : undefined;
    if (code != null && Object.hasOwn(copy.refusal, code)) return copy.refusal[code] ?? copy.refusals.refused;
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      return actionMessageFor(cause, copy.subject, copy.refusals);
    }
    return codedRefusalFor(cause, copy.refusal, copy.refusals.invalidRequest ?? copy.refusals.refused, copy.subject, copy.refusals);
  }

  /*
   * Every verb reads the whole overview again afterwards rather than splicing the answer in:
   * starting one window moves it from "Scheduled" to "In force", and ending one moves it to
   * "Recent", and the service is the one that knows which list each now belongs in.
   */
  async function act(where: string, run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await run();
      setConfirming(null);
      setChangingEnd(null);
      return true;
    } catch (cause) {
      setError({ where, message: messageFor(cause) });
      setConfirming(null);
      return false;
    } finally {
      setBusy(false);
      overview.reload();
      // The console shell's "maintenance is on" strip is server markup; this redraws it.
      router.refresh();
    }
  }

  const data = overview.status === 'ready' ? overview.data : null;
  /*
   * History only: the service sends windows that are over, and a window in force or to come is
   * never drawn here as well. It used to be — with its buttons twice, and a confirmation that
   * opened in both rows at once.
   */
  const live = new Set([...(data?.current ? [data.current.id] : []), ...(data?.upcoming ?? []).map((entry) => entry.id)]);
  const recent = (data?.recent ?? []).filter(
    (entry) => (entry.state === 'ENDED' || entry.state === 'CANCELLED') && !live.has(entry.id),
  );

  function row(entry: MaintenanceWindow) {
    const actions = actionsFor(entry.state);
    const confirmingHere = confirming?.id === entry.id ? confirming.verb : null;

    return (
      <li key={entry.id} className="rounded-lg border border-white/8 bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tag variant={entry.state === 'ACTIVE' ? 'warning' : 'default'}>
            {copy.state[entry.state] ?? entry.state}
          </Tag>
        </div>

        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-white/48">{copy.startsLabel}</dt>
          <dd className="text-white">{time(entry.startsAt)}</dd>

          <dt className="text-white/48">{copy.endsLabel}</dt>
          <dd className="text-white">
            {entry.endsAt === null ? copy.untilFurtherNotice : time(entry.endsAt)}
          </dd>

          {(entry.state === 'SCHEDULED' || entry.state === 'ANNOUNCED') && (
            <>
              <dt className="text-white/48">{copy.announceLabel}</dt>
              <dd className="text-white">{time(entry.announceFrom)}</dd>
            </>
          )}

          {entry.endedAt !== null && (
            <>
              <dt className="text-white/48">{copy.endedLabel}</dt>
              <dd className="text-white">{time(entry.endedAt)}</dd>
            </>
          )}

          {entry.cancelledAt !== null && (
            <>
              <dt className="text-white/48">{copy.cancelledLabel}</dt>
              <dd className="text-white">{time(entry.cancelledAt)}</dd>
            </>
          )}

          {entry.note !== null && (
            <>
              <dt className="text-white/48">{copy.noteLabel}</dt>
              <dd className="whitespace-pre-line text-white/80">{entry.note}</dd>
            </>
          )}
        </dl>

        {confirmingHere !== null ? (
          <div className="mt-4">
            <Confirm
              label={copy.confirmLabel}
              text={
                confirmingHere === 'start'
                  ? copy.startNowConfirm
                  : confirmingHere === 'end'
                    ? copy.endNowConfirm
                    : copy.cancelConfirm
              }
              action={
                confirmingHere === 'start'
                  ? copy.startNowYes
                  : confirmingHere === 'end'
                    ? copy.endNowYes
                    : copy.cancelYes
              }
              working={copy.working}
              back={copy.keep}
              busy={busy}
              onConfirm={() =>
                void act(entry.id, () =>
                  confirmingHere === 'start'
                    ? startWindowNow(entry.id)
                    : confirmingHere === 'end'
                      ? endWindowNow(entry.id)
                      : cancelWindow(entry.id),
                )
              }
              onBack={() => setConfirming(null)}
            />
          </div>
        ) : (
          (actions.startNow || actions.endNow || actions.changeEnd || actions.cancel) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {actions.startNow && (
                <Pill
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirming({ id: entry.id, verb: 'start' })}
                >
                  {copy.startNow}
                </Pill>
              )}
              {actions.endNow && (
                <Pill
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirming({ id: entry.id, verb: 'end' })}
                >
                  {copy.endNow}
                </Pill>
              )}
              {actions.changeEnd && changingEnd !== entry.id && (
                <Pill variant="ghost" size="sm" disabled={busy} onClick={() => setChangingEnd(entry.id)}>
                  {copy.changeEnd}
                </Pill>
              )}
              {actions.cancel && (
                <Pill
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirming({ id: entry.id, verb: 'cancel' })}
                >
                  {copy.cancelWindow}
                </Pill>
              )}
            </div>
          )
        )}

        {changingEnd === entry.id && (
          <EndEditor
            copy={copy}
            entry={entry}
            busy={busy}
            onSave={(endsAt) => void act(entry.id, () => changeWindowEnd(entry.id, endsAt))}
            onCancel={() => setChangingEnd(null)}
          />
        )}

        {error !== null && error.where === entry.id && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
            {error.message}
          </InlineAlert>
        )}
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {overview.status === 'loading' && (
        <SkeletonGroup label={copy.loadingList}>
          <div className="space-y-3">
            {[0, 1].map((line) => (
              <div key={line} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="30%" />
                <Skeleton height="0.875rem" width="60%" className="mt-3" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {overview.status === 'failed' && (
        <div>
          <InlineAlert variant="danger" title={copy.errorTitle}>
            {overview.error}
          </InlineAlert>
          <Pill variant="ghost" size="sm" className="mt-4" onClick={overview.reload}>
            {copy.tryAgain}
          </Pill>
        </div>
      )}

      {zone !== '' && <p className="-mb-6 text-xs text-white/64">{fillPlaceholders(copy.zoneNote, { zone })}</p>}

      {data !== null && (
        <>
          <section aria-labelledby="maintenance-current-heading">
            <h2 id="maintenance-current-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
              {copy.currentHeading}
            </h2>
            {data.current === null ? (
              <p className="mt-2 text-sm text-white/64">{copy.currentEmpty}</p>
            ) : (
              <ul className="mt-4 flex list-none flex-col gap-2">{row(data.current)}</ul>
            )}
          </section>

          <section aria-labelledby="maintenance-upcoming-heading">
            <h2 id="maintenance-upcoming-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
              {copy.upcomingHeading}
            </h2>
            {data.upcoming.length === 0 ? (
              <p className="mt-2 text-sm text-white/64">{copy.upcomingEmpty}</p>
            ) : (
              <ul className="mt-4 flex list-none flex-col gap-2">{data.upcoming.map(row)}</ul>
            )}
          </section>
        </>
      )}

      <ScheduleForm
        copy={copy}
        busy={busy}
        error={error !== null && error.where === SCHEDULE ? error.message : null}
        onSchedule={(request) => act(SCHEDULE, () => scheduleWindow(request))}
      />

      {data !== null && (
        <section aria-labelledby="maintenance-recent-heading">
          <h2 id="maintenance-recent-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
            {copy.recentHeading}
          </h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-white/64">{copy.recentEmpty}</p>
          ) : (
            <ul className="mt-4 flex list-none flex-col gap-2">{recent.map(row)}</ul>
          )}
        </section>
      )}
    </div>
  );
}

interface EndEditorProps {
  readonly copy: MaintenanceConsoleCopy;
  readonly entry: MaintenanceWindow;
  readonly busy: boolean;
  readonly onSave: (endsAt: string | null) => void;
  readonly onCancel: () => void;
}

/**
 * Extend, shorten, or make the end open — one control for all three.
 *
 * An end that is not after both the start and now is refused here, in words, before the
 * request: the service refuses it too, and its schedule sentence — "the start cannot be in the
 * past" — answered somebody who had not touched the start.
 */
function EndEditor({ copy, entry, busy, onSave, onCancel }: EndEditorProps) {
  const [value, setValue] = useState(entry.endsAt === null ? '' : localFromInstant(entry.endsAt));
  const [open, setOpen] = useState(entry.endsAt === null);
  const [tooEarly, setTooEarly] = useState(false);
  const instant = instantFromLocal(value);

  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (open) {
          onSave(null);
          return;
        }
        if (instant === null) return;
        const floor = Math.max(new Date(entry.startsAt).getTime(), Date.now());
        if (new Date(instant).getTime() <= floor) {
          setTooEarly(true);
          return;
        }
        onSave(instant);
      }}
    >
      <Field label={copy.newEndLabel} error={tooEarly && !open ? copy.endInvalid : undefined} className="max-w-[320px]">
        <TextInput
          type="datetime-local"
          value={value}
          disabled={open}
          onChange={(event) => {
            setValue(event.target.value);
            setTooEarly(false);
          }}
        />
      </Field>
      <Checkbox label={copy.openEndLabel} checked={open} onChange={(event) => setOpen(event.target.checked)} />
      <div className="flex flex-wrap gap-2">
        <Pill type="submit" variant="outline" size="sm" disabled={busy || (!open && instant === null)}>
          {busy ? copy.working : copy.saveEnd}
        </Pill>
        <Pill variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Pill>
      </div>
    </form>
  );
}

interface ScheduleFormProps {
  readonly copy: MaintenanceConsoleCopy;
  readonly busy: boolean;
  /** The service's refusal of the last schedule, said under the form it is about. */
  readonly error: string | null;
  readonly onSchedule: (request: Parameters<typeof scheduleWindow>[0]) => Promise<boolean>;
}

function ScheduleForm({ copy, busy, error, onSchedule }: ScheduleFormProps) {
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [announceFrom, setAnnounceFrom] = useState('');
  const [note, setNote] = useState('');
  /*
   * The zone is named in the intro, and read after mount: the server renders this form too,
   * and its zone is the container's rather than the reader's.
   */
  const [zone, setZone] = useState('');
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '');
    } catch {
      setZone('');
    }
  }, []);

  const start = instantFromLocal(startsAt);
  const [startsNow, setStartsNow] = useState(false);

  /*
   * A start that has already come — "now", or a minute ago — is taken as now by the service, and
   * the window is in force the moment it is saved. That is Start now by another route, and it
   * asks the same question first.
   */
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (start === null) return;
    if (new Date(start).getTime() <= Date.now() + STARTS_NOW_WITHIN_MS) {
      setStartsNow(true);
      return;
    }
    void send();
  }

  async function send(): Promise<void> {
    if (start === null) return;
    const scheduled = await onSchedule({
      startsAt: start,
      endsAt: instantFromLocal(endsAt),
      announceFrom: instantFromLocal(announceFrom),
      note: note.trim() === '' ? null : note.trim(),
    });
    setStartsNow(false);
    // Kept on a refusal, so an overlap can be fixed by moving one field rather than four.
    if (!scheduled) return;
    setStartsAt('');
    setEndsAt('');
    setAnnounceFrom('');
    setNote('');
  }

  return (
    <section aria-labelledby="maintenance-schedule-heading">
      <h2 id="maintenance-schedule-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
        {copy.scheduleHeading}
      </h2>
      {zone !== '' && (
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{fillPlaceholders(copy.scheduleIntro, { zone })}</p>
      )}

      <form onSubmit={submit} className="mt-4 grid max-w-[640px] gap-4 sm:grid-cols-2">
        <Field label={copy.startsAtLabel} required>
          <TextInput type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </Field>
        <Field label={copy.endsAtLabel} hint={copy.endsAtHint}>
          <TextInput type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </Field>
        <Field label={copy.announceFromLabel} hint={copy.announceFromHint}>
          <TextInput
            type="datetime-local"
            value={announceFrom}
            onChange={(event) => setAnnounceFrom(event.target.value)}
          />
        </Field>
        <Field label={copy.noteFieldLabel} hint={copy.noteHint} className="sm:col-span-2">
          <Textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          {startsNow ? (
            <Confirm
              label={copy.confirmLabel}
              text={copy.scheduleNowConfirm}
              action={copy.scheduleNowYes}
              working={copy.working}
              back={copy.keep}
              busy={busy}
              onConfirm={() => void send()}
              onBack={() => setStartsNow(false)}
            />
          ) : (
            <Pill type="submit" variant="outline" size="sm" disabled={busy || start === null}>
              {busy ? copy.working : copy.schedule}
            </Pill>
          )}
        </div>
      </form>

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4 max-w-[640px]">
          {error}
        </InlineAlert>
      )}
    </section>
  );
}
