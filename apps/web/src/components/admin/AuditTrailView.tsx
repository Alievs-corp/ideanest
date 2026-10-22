'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Chip,
  ChipRow,
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Switch,
  Tag,
  TextInput,
} from '@ideanest/ui';
import {
  AUDIT_ENTITY_TYPES,
  TRAIL_PAGE_SIZE,
  actionLabel,
  dayBounds,
  isAboutItsActor,
  readTrail,
  type AuditEntry,
} from '../../lib/admin/audit';
import type { AdminUser } from '../../lib/admin/api';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  shortId,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import { holds } from '../../lib/admin/staff';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { AuditTrailCopy } from '../../lib/i18n/admin/platform-copy';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatExactTime } from '../../lib/time';
import type { Locale } from '../../lib/i18n/locale';
import type { DirectoryNames } from '../../lib/admin/directory';
import { AccountPicker } from './AccountPicker';
import { ConsoleCount } from './ConsoleCount';
import { useConsoleMembership } from './ConsoleMembership';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * §4.11's AD-14: what has been done, by whom, to what — issue #314.
 *
 * <h2>Newest first, where the report queue is oldest first</h2>
 *
 * <p><strong>And it now is — issue #404.</strong> This heading was true of the intent and
 * false of the page. The service ordered by the primary key, on the argument that a UUID v7
 * carries the millisecond it was minted in (§7.3); the key is minted by the application and
 * `occurred_at` is `DEFAULT now()`, so the two disagree, and this screen displays the second
 * while the query ordered by the first. Walked against the local seed, the first fourteen
 * rows were from the previous month and that morning's eight privileged actions began at
 * position fifteen. An investigator who opens the log and sees August at the top has no
 * reason to scroll for this morning.
 *
 * Not a preference. A queue is worked from the front — the complaint that has waited longest
 * is the one that matters — and a trail is read from the end: "what has just happened", "what
 * did that account do before it was stopped". The row somebody wants is almost always the
 * most recent one that matches.
 *
 * <h2>Four filters, and the reason there are not more</h2>
 *
 * The service narrows by entity kind, by one entity, or by one actor, because those are the
 * three indexes V21 created — and, since #404, by a date range, which is the one filter that
 * costs nothing because `occurred_at DESC` is the trailing column of all four of those
 * indexes.
 *
 * That issue is also why the actor filter has a control at all. The service had accepted
 * `actorId` since #314 and the screen offered no way to set one, so "what did this person do"
 * — the question an audit log exists to answer — was reachable only by editing the URL.
 *
 * <p>There are two controls for it now. Every row's actor has "this person's actions", which
 * any reader of the trail may press. `AccountPicker` searches the account directory, which is
 * `ADMINISTER_ACCOUNTS`'s, so it is drawn only for a reader who holds that: a curator or finance
 * was handed a search box that could only ever answer with a refusal. The actor combines with
 * the kind chips on the service — it used to be dropped whenever a kind was set.
 *
 * <h2>Reads are hidden by default</h2>
 *
 * <p>Every page, chip and date of this screen writes an `audit.trail_read`, and every visit to
 * the front page a `dashboard.read`. Unfiltered, the trail opened on the reader's own reads. The
 * switch asks the service to leave out the routine screen reads and is on when the screen opens;
 * opening one person's private record — an identity document, a signed agreement, a bank
 * account — is never hidden, because that is the read an investigation is looking for.
 *
 * There is still no filter on the action and no search over the free text, and this screen
 * does not offer either client-side — a chip that filtered the twenty-five loaded rows in the
 * browser would say "3 results" about a table with four thousand matching rows in it, which
 * on an audit surface is not a rough edge but a wrong answer. `lib/admin/audit.ts` records
 * what each missing filter would cost.
 *
 * <h2>Nothing here can change anything</h2>
 *
 * There is no action on any row, because there is no endpoint that could take one: V21 puts a
 * trigger on `audit_logs` that raises on UPDATE, DELETE and TRUNCATE. That is the property
 * that makes the screen worth reading, and it is why this is the one console screen with no
 * confirmation dialog in it.
 *
 * <h2>Reading it is itself recorded</h2>
 *
 * Every page drawn here writes a row to the table being drawn. That is intended: an audit
 * surface nobody audits is the surface an investigation starts by distrusting. The screen
 * says so, because a reader who saw their own reads appear and had not been told would think
 * something was wrong.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 gives an administrative surface no budget beyond 150ms of colour
 * on a control, and §8 forbids animation in long lists regardless. This is both.
 *
 * <h2>Every word arrives as a prop</h2>
 *
 * Resolved by the route on the server and handed down, since #324. The two label tables come
 * with it: `lib/admin/audit.ts` used to carry the English for each entity kind and each action
 * beside the list of which ones exist, and the words moved to `admin.screens.audit` while the
 * list stayed where it was.
 */
export interface AuditTrailViewProps {
  readonly copy: AuditTrailCopy;
}

/**
 * Whose actions the trail is narrowed to.
 *
 * <p>The account record when the person was found with `AccountPicker`, which needs it to draw who
 * is chosen; only the identifier when the filter came from a row's "this person's actions", which
 * any reader of the trail may use — the directory names them on the applied-filter line.
 */
interface ActorFilter {
  readonly id: string;
  readonly account: AdminUser | null;
}

/** How long the date fields wait after the last change before the trail is read again. */
const DATE_DEBOUNCE_MS = 400;

export function AuditTrailView({ copy }: AuditTrailViewProps) {
  const locale = useRouteLocale();
  const { membership } = useConsoleMembership();
  // The picker searches `/v1/admin/users`, which is ADMINISTER_ACCOUNTS'. A curator or finance
  // reader of the trail was handed a search box that could only ever answer with a refusal; they
  // narrow to a person from that person's row instead.
  const mayPick = holds(membership, 'ADMINISTER_ACCOUNTS');

  const [status, setStatus] = useState<ConsoleStatus>('loading');
  // #400: which of the two 403s this is. Only read while `status` is `forbidden`.
  const [capability, setCapability] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<string | null>(null);
  const [actor, setActor] = useState<ActorFilter | null>(null);
  /*
   * The two dates as the fields hold them, and as the trail was last read with. A date field
   * changes on every keystroke of a typed year — 2, 20, 202, 2026 — and each of those was a read
   * of the trail and a row written to it. The read waits until the field has been still.
   */
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [days, setDays] = useState<{ readonly from: string; readonly to: string }>({ from: '', to: '' });
  // On by default: the trail is read for what was done, and without this its first page is the
  // reader's own reads of it. The switch is one press away, and a look at somebody's private
  // record is never hidden either way.
  const [hideReads, setHideReads] = useState(true);
  const [entries, setEntries] = useState<readonly AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The "load more" in flight. A new question aborts it, so a page of the old one cannot be
  // appended to the new one's rows.
  const more = useRef<AbortController | null>(null);

  const actorId = actor?.id ?? null;

  useEffect(() => {
    if (fromDay === days.from && toDay === days.to) return;
    const timer = setTimeout(() => setDays({ from: fromDay, to: toDay }), DATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fromDay, toDay, days]);

  /** Whether the reader has narrowed the trail at all, which decides what an empty page says. */
  const narrowed = entityType !== null || actorId !== null || days.from !== '' || days.to !== '' || hideReads;

  useEffect(() => {
    const controller = new AbortController();

    // A new question: whatever the previous one was still loading is not part of it.
    more.current?.abort();
    more.current = null;
    setLoadingMore(false);

    async function load(): Promise<void> {
      setStatus('loading');
      try {
        const page = await readTrail({
          entityType,
          actorId,
          from: dayBounds(days.from, 'from'),
          to: dayBounds(days.to, 'to'),
          hideReads,
          limit: TRAIL_PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setEntries(page.entries);
        setCursor(page.nextCursor ?? null);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        const next = statusFor(cause);
        setCapability(requiredCapabilityFrom(cause));
        if (next === 'failed') setError(consoleMessageFor(cause, copy.subject, copy.refusals));
        setStatus(next);
      }
    }

    void load();
    return () => controller.abort();
    // `copy` is not a dependency: it is one object per server render, so it changes only when
    // the language does, and the language is a path segment that remounts this tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, actorId, days, hideReads, attempt]);

  useEffect(() => () => more.current?.abort(), []);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || more.current !== null) return;

    const controller = new AbortController();
    more.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await readTrail({
        entityType,
        actorId,
        from: dayBounds(days.from, 'from'),
        to: dayBounds(days.to, 'to'),
        hideReads,
        after: cursor,
        limit: TRAIL_PAGE_SIZE,
        signal: controller.signal,
      });
      // The question changed while this page was on its way: it is not a page of this list.
      if (controller.signal.aborted) return;
      setEntries((previous) => [...previous, ...page.entries]);
      setCursor(page.nextCursor ?? null);
    } catch (cause) {
      if (controller.signal.aborted || wasAborted(cause)) return;
      setError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      if (more.current === controller) {
        more.current = null;
        setLoadingMore(false);
      }
    }
  }, [cursor, entityType, actorId, days, hideReads, copy]);

  /*
   * Who did it and, where the platform can say, what it was done to — #402. An audit trail
   * exists to be read after the fact by somebody who was not there, and "moderator 4ae450ba
   * suspended account c8edac99" is a sentence that cannot be read at all.
   */
  const names = useDirectoryNames(
    [
      ...(actorId === null ? [] : [actorId]),
      ...entries.flatMap((entry) => [
        entry.actorId ?? null,
        entry.entityType === 'account' ? entry.entityId : null,
      ]),
    ].filter((id): id is string => id != null),
    entries.filter((entry) => entry.entityType === 'project').map((entry) => entry.entityId),
  );

  if (status === 'signed-out' || status === 'forbidden') {
    return <ConsoleRefusal status={status} capability={capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const chooseActor = (id: string) => setActor({ id, account: null });

  return (
    <section aria-labelledby="audit-trail-heading">
      <h2
        id="audit-trail-heading"
        className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg"
      >
        {copy.heading}
        {status === 'ready' && (
          <ConsoleCount loaded={entries.length} more={cursor !== null} copy={copy.count} />
        )}
      </h2>

      {/*
        Every chip here reaches the service. There is deliberately no client-side narrowing
        on this screen — see the docblock on why a count that means "of the page" is a wrong
        answer on an audit surface rather than a rough edge.
      */}
      <ChipRow aria-label={copy.filterLabel} className="mt-4">
        <Chip active={entityType === null} onClick={() => setEntityType(null)}>
          {copy.everything}
        </Chip>
        {AUDIT_ENTITY_TYPES.map((value) => (
          <Chip key={value} active={entityType === value} onClick={() => setEntityType(value)}>
            {copy.entity[value] ?? value}
          </Chip>
        ))}
      </ChipRow>

      {/*
        #404: who, and when. Each control produces one read when it changes — the dates once the
        field has been still for a moment.

        `fieldset` rather than loose fields, so that a screen reader announces the group before
        its parts: "when" is what the two dates mean together.

        The hint sits under the whole row rather than inside each field, as on the payment log
        (#504): inside, it made the fields taller than the control beside them and the row lined
        "clear dates" up with the hint instead of with the boxes.
      */}
      <fieldset className="mt-4">
        <legend className="text-sm text-fg-64">{copy.narrowLabel}</legend>

        {/* The person and the days are two rows, each with its own hint directly under it: side
            by side, the picker's hint pushed the date boxes down and the dates' hint landed
            under the person. */}
        {mayPick && (
          <AccountPicker
            chosen={actor?.account ?? null}
            onChoose={(account) => setActor(account === null ? null : { id: account.id, account })}
            copy={copy.actorPicker}
            className="mt-2 max-w-[560px]"
          />
        )}

        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">

          {/*
            `type="date"` rather than a text field. The format a person types differs by
            language — §21.1 puts the console in four — and the browser's own control renders
            the reader's format over a value that is always `YYYY-MM-DD`.
          */}
          <Field label={copy.fromLabel} className="min-w-[160px]">
            <TextInput
              type="date"
              value={fromDay}
              max={toDay === '' ? undefined : toDay}
              aria-describedby={datesHintId}
              onChange={(event) => setFromDay(event.target.value)}
            />
          </Field>

          <Field label={copy.toLabel} className="min-w-[160px]">
            <TextInput
              type="date"
              value={toDay}
              min={fromDay === '' ? undefined : fromDay}
              aria-describedby={datesHintId}
              onChange={(event) => setToDay(event.target.value)}
            />
          </Field>

          {(fromDay !== '' || toDay !== '') && (
            // As tall as the inputs, so the control is centred on the boxes.
            <div className="flex min-h-11 items-center">
              <Pill
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFromDay('');
                  setToDay('');
                }}
              >
                {copy.clearDates}
              </Pill>
            </div>
          )}
        </div>
        <p id={datesHintId} className="mt-1.5 text-[13px] text-fg-64">
          {copy.datesHint}
        </p>

        <div className="mt-3 flex flex-col gap-1">
          <Switch
            checked={hideReads}
            onCheckedChange={setHideReads}
            label={copy.hideReads}
            aria-describedby={hideReadsHintId}
            className="self-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          />
          <p id={hideReadsHintId} className="text-[13px] text-fg-64">
            {copy.hideReadsHint}
          </p>
        </div>
      </fieldset>

      {/* The person the trail is narrowed to, when the picker is not the thing saying so. */}
      {actor !== null && actor.account === null && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-fg/16 px-3 py-2 text-sm text-fg-80">
          <span>{copy.actorApplied}</span>
          <EntityName id={actor.id} names={names} kind="account" copy={copy.identity} />
          <Pill variant="ghost" size="sm" onClick={() => setActor(null)}>
            {copy.everyone}
          </Pill>
        </div>
      )}

      {error && (
        <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="30%" />
                <Skeleton height="0.875rem" width="60%" className="mt-3" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && entries.length === 0 && (
        <EmptyState
          className="mt-4"
          /* Any of the filters narrows the trail, so an empty page under one of them is
             "nothing matched" rather than "nothing has ever happened" — #404. */
          variant={narrowed ? 'filtered' : 'empty'}
          title={narrowed ? copy.filteredTitle : copy.emptyTitle}
          description={narrowed ? copy.filteredBody : copy.emptyBody}
        />
      )}

      {status === 'ready' && entries.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-2">
          {entries.map((entry) => (
            <AuditRow
              key={entry.id}
              entry={entry}
              locale={locale}
              names={names}
              copy={copy}
              narrowedTo={actorId}
              onNarrowTo={chooseActor}
            />
          ))}
        </ul>
      )}

      {status === 'ready' && cursor !== null && (
        <Pill
          variant="ghost"
          size="sm"
          className="mt-4"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? copy.loading : copy.loadMore}
        </Pill>
      )}

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
          {copy.tryAgain}
        </Pill>
      )}

      <p className="mt-8 max-w-[68ch] text-sm text-fg-48">{copy.footnote}</p>
    </section>
  );
}

const datesHintId = 'audit-dates-hint';
const hideReadsHintId = 'audit-hide-reads-hint';

/**
 * One recorded action.
 *
 * <p><strong>A refusal is drawn as prominently as a success</strong>, in `warning` rather
 * than in `danger`. `REFUSED` means somebody tried something they were not entitled to and
 * the platform said no — which is the trail working, not the platform failing — and it is
 * also the single most interesting row on this screen. Red would say the system broke; the
 * word says what actually happened, and docs/ui-kit.md §9.2 requires the word either way.
 *
 * <p><strong>What it was done to, then who did it, each said once.</strong> The thing is named
 * with its kind in the singular — "Campaign Foo", not the chip's "Campaigns Foo" — and a row about
 * the account that wrote it (a read, a search, one's own settings) names that person once, as the
 * actor.
 *
 * <p><strong>The detail is a technical note, and is drawn as one.</strong> It is what the action
 * recorded about itself in the service's own `key=value` vocabulary, which is evidence rather
 * than prose: folded under its own summary, in a monospaced face, so the row reads as a sentence
 * and the note is there for whoever needs it.
 */
function AuditRow({
  entry,
  locale,
  names,
  copy,
  narrowedTo,
  onNarrowTo,
}: {
  readonly entry: AuditEntry;
  readonly locale: Locale;
  readonly names: DirectoryNames;
  readonly copy: AuditTrailCopy;
  readonly narrowedTo: string | null;
  readonly onNarrowTo: (actorId: string) => void;
}) {
  const aboutItsActor = isAboutItsActor(entry);
  const actorName =
    entry.actorId == null ? null : (names.accounts.get(entry.actorId)?.name ?? shortId(entry.actorId));

  return (
    <li className="rounded-lg border border-fg/8 bg-surface-1 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-sm sm:text-[15px] font-medium text-fg">{actionLabel(entry.action, copy.action)}</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-fg-64">
            {!aboutItsActor && (
              <>
                <span>{copy.entityOne[entry.entityType] ?? entry.entityType}</span>
                {/*
                  #402: an audit row's whole purpose is accountability. A campaign and an account
                  are things the directory can name; the rest keep the fragment, because a
                  session or a payout is not a thing with a name.
                */}
                {entry.entityType === 'project' || entry.entityType === 'account' ? (
                  <EntityName
                    id={entry.entityId}
                    names={names}
                    kind={entry.entityType === 'project' ? 'project' : 'account'}
                    copy={copy.identity}
                  />
                ) : (
                  <span className="font-mono" title={entry.entityId}>
                    {shortId(entry.entityId)}
                  </span>
                )}
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{copy.actorType[entry.actorType] ?? entry.actorType}</span>
            {entry.actorId != null && (
              <EntityName id={entry.actorId} names={names} kind="account" copy={copy.identity} />
            )}
            {/* Beside the name it narrows to, and as quiet as a link: on a page of twenty-five
                rows a button on each was the loudest thing on the screen. */}
            {entry.actorId != null && entry.actorId !== narrowedTo && actorName !== null && (
              <button
                type="button"
                className="rounded text-xs text-fg-64 underline decoration-fg/24 underline-offset-2 hover:text-fg hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                aria-label={fillPlaceholders(copy.byThisPersonLabel, { name: actorName })}
                onClick={() => onNarrowTo(entry.actorId as string)}
              >
                {copy.byThisPerson}
              </button>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {entry.outcome === 'REFUSED' && <Tag variant="warning">{copy.refused}</Tag>}
          <time
            dateTime={entry.occurredAt}
            className="text-xs text-fg-48"
            title={entry.occurredAt}
          >
            {formatExactTime(entry.occurredAt, locale)}
          </time>
        </div>
      </div>

      {/*
        The service's own note and the correlation identifier, folded together: both are for
        whoever goes from this row to the logs, and neither is something a reader scans for. The
        request id is the one thing here that reaches outside the database — the same value is on
        the request's log lines.
      */}
      {(hasText(entry.detail) || hasText(entry.requestId)) && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer rounded text-fg-64 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
            {copy.technicalNote}
          </summary>
          {hasText(entry.detail) && (
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-64">{entry.detail}</p>
          )}
          {hasText(entry.requestId) && (
            <p className="mt-1 break-all font-mono text-xs text-fg-48">
              {fillPlaceholders(copy.requestId, { id: entry.requestId })}
            </p>
          )}
        </details>
      )}
    </li>
  );
}

function hasText(value: string | null | undefined): value is string {
  return value != null && value !== '';
}
