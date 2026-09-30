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
  readMaintenance,
  scheduleWindow,
  startWindowNow,
  type MaintenanceWindow,
} from '../../lib/admin/maintenance';
import { ApiError } from '../../lib/api/problem';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { MaintenanceConsoleCopy } from '../../lib/i18n/admin/platform-copy';
import { formatExactTime } from '../../lib/time';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * `/admin/maintenance` — §19.6, issue #214.
 *
 * <h2>Two verbs ask twice, and the confirmation is inline</h2>
 *
 * Start now and End now take effect for every reader within ten seconds, so neither is the
 * first press: the consequence is stated, and the button that acts is the second. It is a
 * panel in place rather than a dialog — the motion `Modal` costs a route ninety-odd kilobytes
 * of animation runtime, and `ReviewPanel` settled the pattern for the campaign launch.
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

type Confirming = { readonly id: string; readonly verb: 'start' | 'end' } | null;

export function MaintenanceConsole({ copy }: MaintenanceConsoleProps) {
  const locale = useRouteLocale();
  const router = useRouter();
  const overview = useConsoleResource((signal) => readMaintenance(signal), copy.subject, copy.refusals, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [changingEnd, setChangingEnd] = useState<string | null>(null);

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

  /** A service refusal in the reader's language, when this screen was taught its code. */
  function messageFor(cause: unknown): string {
    const code = cause instanceof ApiError ? cause.problem?.code : undefined;
    const known = code === undefined ? undefined : copy.refusal[code];
    return known ?? consoleMessageFor(cause, copy.subject, copy.refusals);
  }

  /*
   * Every verb reads the whole overview again afterwards rather than splicing the answer in:
   * starting one window moves it from "Scheduled" to "In force", and ending one moves it to
   * "Recent", and the service is the one that knows which list each now belongs in.
   */
  async function act(run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await run();
      setConfirming(null);
      setChangingEnd(null);
      return true;
    } catch (cause) {
      setError(messageFor(cause));
      return false;
    } finally {
      setBusy(false);
      overview.reload();
      // The console shell's "maintenance is on" strip is server markup; this redraws it.
      router.refresh();
    }
  }

  const data = overview.status === 'ready' ? overview.data : null;

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

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
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
          <div
            role="group"
            aria-labelledby={`maintenance-confirm-${entry.id}`}
            className="mt-4 rounded-lg border border-white/8 bg-surface-2 p-4"
          >
            <p id={`maintenance-confirm-${entry.id}`} className="text-sm text-white">
              {confirmingHere === 'start' ? copy.startNowConfirm : copy.endNowConfirm}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill
                variant="danger"
                size="sm"
                // Focus follows the question, so nobody who cannot see it appear misses it.
                autoFocus
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    confirmingHere === 'start' ? startWindowNow(entry.id) : endWindowNow(entry.id),
                  )
                }
              >
                {busy ? copy.working : confirmingHere === 'start' ? copy.startNowYes : copy.endNowYes}
              </Pill>
              <Pill variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                {copy.keep}
              </Pill>
            </div>
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
                  onClick={() => void act(() => cancelWindow(entry.id))}
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
            onSave={(endsAt) => void act(() => changeWindowEnd(entry.id, endsAt))}
            onCancel={() => setChangingEnd(null)}
          />
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

      {error && (
        <InlineAlert variant="danger" title={copy.failedTitle}>
          {error}
        </InlineAlert>
      )}

      {data !== null && (
        <>
          <section aria-labelledby="maintenance-current-heading">
            <h2 id="maintenance-current-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
              {copy.currentHeading}
            </h2>
            {data.current === null ? (
              <p className="mt-2 text-sm text-white/64">{copy.currentEmpty}</p>
            ) : (
              <ul className="mt-4 flex list-none flex-col gap-2">{row(data.current)}</ul>
            )}
          </section>

          <section aria-labelledby="maintenance-upcoming-heading">
            <h2 id="maintenance-upcoming-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
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

      <ScheduleForm copy={copy} busy={busy} onSchedule={(request) => act(() => scheduleWindow(request))} />

      {data !== null && (
        <section aria-labelledby="maintenance-recent-heading">
          <h2 id="maintenance-recent-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
            {copy.recentHeading}
          </h2>
          {data.recent.length === 0 ? (
            <p className="mt-2 text-sm text-white/64">{copy.recentEmpty}</p>
          ) : (
            <ul className="mt-4 flex list-none flex-col gap-2">{data.recent.map(row)}</ul>
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

/** Extend, shorten, or make the end open — one control for all three. */
function EndEditor({ copy, entry, busy, onSave, onCancel }: EndEditorProps) {
  const [value, setValue] = useState(entry.endsAt === null ? '' : localFromInstant(entry.endsAt));
  const [open, setOpen] = useState(entry.endsAt === null);
  const instant = instantFromLocal(value);

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (open) onSave(null);
        else if (instant !== null) onSave(instant);
      }}
    >
      <Field label={copy.newEndLabel} className="min-w-[220px]">
        <TextInput
          type="datetime-local"
          value={value}
          disabled={open}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <Checkbox
        label={copy.openEndLabel}
        checked={open}
        onChange={(event) => setOpen(event.target.checked)}
        className="mb-2"
      />
      <Pill type="submit" variant="outline" size="sm" className="mb-1" disabled={busy || (!open && instant === null)}>
        {busy ? copy.working : copy.saveEnd}
      </Pill>
      <Pill variant="ghost" size="sm" className="mb-1" disabled={busy} onClick={onCancel}>
        {copy.cancel}
      </Pill>
    </form>
  );
}

interface ScheduleFormProps {
  readonly copy: MaintenanceConsoleCopy;
  readonly busy: boolean;
  readonly onSchedule: (request: Parameters<typeof scheduleWindow>[0]) => Promise<boolean>;
}

function ScheduleForm({ copy, busy, onSchedule }: ScheduleFormProps) {
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

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (start === null) return;

    const scheduled = await onSchedule({
      startsAt: start,
      endsAt: instantFromLocal(endsAt),
      announceFrom: instantFromLocal(announceFrom),
      note: note.trim() === '' ? null : note.trim(),
    });
    // Kept on a refusal, so an overlap can be fixed by moving one field rather than four.
    if (!scheduled) return;
    setStartsAt('');
    setEndsAt('');
    setAnnounceFrom('');
    setNote('');
  }

  return (
    <section aria-labelledby="maintenance-schedule-heading">
      <h2 id="maintenance-schedule-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.scheduleHeading}
      </h2>
      {zone !== '' && (
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{fillPlaceholders(copy.scheduleIntro, { zone })}</p>
      )}

      <form onSubmit={(event) => void submit(event)} className="mt-4 grid max-w-[640px] gap-4 sm:grid-cols-2">
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
          <Pill type="submit" variant="outline" size="sm" disabled={busy || start === null}>
            {busy ? copy.working : copy.schedule}
          </Pill>
        </div>
      </form>
    </section>
  );
}
