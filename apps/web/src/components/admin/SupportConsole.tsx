'use client';

import { Suspense, lazy, useState } from 'react';
import {
  Checkbox,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Select,
  Skeleton,
  SkeletonGroup,
  Tag,
  Textarea,
} from '@ideanest/ui';
import {
  TICKET_PRIORITIES,
  TICKET_STATES,
  listTickets,
  narrows,
  readTicket,
  readTicketQueue,
  replyToTicket,
  updateTicket,
  type Ticket,
  type TicketFilter,
  type TicketPriority,
  type TicketState,
} from '../../lib/admin/tickets';
import type { AdminUser } from '../../lib/admin/api';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { pluralise } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate, formatExactTime } from '../../lib/time';
import type { SupportConsoleCopy } from '../../lib/i18n/admin/people-copy';
import { AccountPicker } from './AccountPicker';
import { ConsoleCount } from './ConsoleCount';
import { useConsoleMembership } from './ConsoleMembership';
import { ConsoleRefusal } from './ConsoleRefusal';
import { CopyIdentifier, EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * §4.11's AD-10: tickets with user context and action history — issue #310.
 *
 * <h2>The context is why this is not a mailbox</h2>
 *
 * A support conversation about a pledge is read beside that pledge, the account&apos;s
 * standing, and every other ticket the same person has raised. An email client knows none of
 * those, which is what #310 was actually about — the store was missing because the screen
 * needed a shape a mailbox cannot have.
 *
 * So opening a ticket shows three things at once: the ticket, its thread, and the rest of that
 * person&apos;s history. The fifth complaint from one account is a different conversation from
 * the first, and nobody should have to go and look for that.
 *
 * <h2>An internal note does not move the ticket</h2>
 *
 * Staff talking to staff leaves the requester still waiting, so the ticket stays where it is.
 * Everything else about a reply does move it, in the entity rather than here — a reply that did
 * not take the ticket off the queue is a reply the next person has to notice by reading it.
 *
 * <h2>A pledge's ticket is where a bank refund's account comes from — #400</h2>
 *
 * A refund past the provider's window is paid by bank transfer, and the backer gives the account
 * in a support conversation. So a ticket about a pledge carries the form that records it on that
 * pledge, with this ticket as its source; `RefundBankDetailsForm` says what it checks.
 *
 * <h2>A backer who wrote in elsewhere gets a ticket from here — #416</h2>
 *
 * The backer cannot raise one, so the account above had nowhere to come from. Support opens one
 * in their name from the pledge they quoted, and records the account against it in the same
 * place; `BackerTicketForm` has the rest.
 */
/**
 * #400's refund bank-account form, fetched when a pledge's ticket is opened. Bundled with the
 * console it put `/admin/support` well over its First Load JS budget (the IBAN rules and
 * `decimal.js`), and no other ticket needs it. `React.lazy` for `PayoutQueue`'s reason; the form
 * decides for itself whether the reader may be offered it.
 */
const RefundBankDetailsForm = lazy(() =>
  import('./RefundBankDetailsForm').then((module) => ({ default: module.RefundBankDetailsForm })),
);

/* #416's ticket for a backer. Bundled, it put `/admin/support` 3.6 KiB over its budget again. */
const BackerTicketForm = lazy(() =>
  import('./BackerTicketForm').then((module) => ({ default: module.BackerTicketForm })),
);

export interface SupportConsoleProps {
  readonly copy: SupportConsoleCopy;
}

/**
 * The tone a priority is drawn in. Always beside its word, never colour alone. An urgent ticket
 * and a low one were the same grey chip, on the screen whose order is the priority.
 */
const PRIORITY_TONE: Readonly<Record<TicketPriority, 'danger' | 'warning' | 'default'>> = {
  URGENT: 'danger',
  HIGH: 'warning',
  NORMAL: 'default',
  LOW: 'default',
};

export function SupportConsole({ copy }: SupportConsoleProps) {
  const locale = useRouteLocale();
  const [page, setPage] = useState(0);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  /*
   * #404: five tickets and no filter of any kind — not by priority, not by state, not by who
   * is handling it, though every row displayed all three and the copy under the list explains
   * that staff set the priority.
   *
   * `filter` being empty is the queue and not "the list with nothing selected", which is the
   * one design decision here. The queue is a different question with a different order —
   * `readTicketQueue` is open work, most urgent first, and the list is everything, newest
   * first — so the default view stays what this screen has always been, and choosing any
   * filter moves to the list. Widening the queue with filters would have been the smaller
   * change and would have left a queue whose order no longer means "work this from the front".
   */
  const [filter, setFilter] = useState<TicketFilter>({});
  const filtering = narrows(filter);

  /*
   * Who is handling it, as a person rather than an identifier — #414.
   *
   * `GET /v1/admin/tickets` has accepted `assigneeId` since #404 and the screen offered no way
   * to set one, so "what is on my plate" and "what is on theirs" — the two questions a person
   * working a queue actually asks — were reachable only by editing the URL. The third chip row
   * was two chips wide and answered only the operational one: what has nobody picked up.
   *
   * Held as the whole account and not as its identifier, for the reason the audit trail's
   * actor filter holds one: `AccountPicker` hands the account back, and it is what lets the
   * applied filter be rendered as a colleague instead of thirty-six characters. `filter`
   * carries the identifier, because that is what the service takes.
   */
  const [assignee, setAssignee] = useState<AdminUser | null>(null);

  /** Every change of filter starts at the first page; page four of a different list is not a page. */
  function narrow(next: TicketFilter): void {
    setFilter(next);
    setPage(0);
    setOpenTicket(null);
  }

  /*
   * The assignment row is one question with three answers, so its three controls move together.
   *
   * "Nobody yet" and a named colleague are mutually exclusive: a null assignee already means
   * "anybody's" and one value cannot also mean "nobody's". Sent together they are a
   * contradiction, and the service answers it with nothing — which is correct, and is not
   * something a screen should let a reader stumble into. So choosing somebody clears
   * `unassigned`, choosing "Nobody yet" clears the person, and "Anyone" clears both.
   */
  function assignTo(account: AdminUser | null): void {
    setAssignee(account);
    narrow({ ...filter, assigneeId: account?.id ?? null, unassigned: false });
  }

  function showUnassigned(only: boolean): void {
    setAssignee(null);
    narrow({ ...filter, assigneeId: null, unassigned: only });
  }

  /*
   * "Queue" clears every filter, the named assignee included. It cleared `filter` and left the
   * picker holding a colleague, so the screen named somebody over the whole queue.
   */
  function backToQueue(): void {
    setAssignee(null);
    narrow({});
  }

  const queue = useConsoleResource(
    (signal) => (filtering ? listTickets(filter, page, signal) : readTicketQueue(page, signal)),
    copy.subject,
    copy.refusals,
    [page, filter],
  );

  /*
   * Who asked and who is handling it — #402. A ticket row read "7d09800a · 2026-08-22 ·
   * 4a10278a", which is a conversation between two people neither of whom the screen could
   * name, on the screen whose whole subject is that conversation.
   */
  const names = useDirectoryNames(
    (queue.data?.tickets ?? []).flatMap((ticket) => [
      ticket.requesterId,
      ticket.assigneeId ?? null,
    ]).filter((id): id is string => id != null),
    [],
  );

  if (queue.status === 'signed-out' || queue.status === 'forbidden') {
    return <ConsoleRefusal status={queue.status} capability={queue.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  /*
   * What is on screen. The last answer stays while the next one is read, so that answering a
   * ticket, which reloads this list, no longer swaps the list for a skeleton, unmounts the open
   * ticket under the reader and throws away whatever they had typed into it. A change of filter
   * closes the open ticket on its own, in `narrow`.
   */
  const tickets = queue.data?.tickets ?? null;
  const firstRead = tickets === null && queue.status === 'loading';

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="queue-heading" aria-busy={queue.status === 'loading'}>
        <h2 id="queue-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {/*
            The heading said "Open tickets" and the intro "most urgent first" over every view,
            "Resolved" included, which is neither open nor in that order. A filter reads the
            list, newest first, and the heading says so.
          */}
          {filtering ? copy.listHeading : copy.heading}
          {/*
            #404 again, in miniature: this badge printed the length of the loaded page as
            though it were the population, which is the defect `ConsoleCount` exists for. The
            list pages rather than cursors, so "there are more" comes from `hasMore` — the same
            fact the pager below is built on, and the two can no longer disagree.
          */}
          {tickets !== null && (
            <ConsoleCount
              loaded={queue.data?.tickets.length ?? 0}
              more={queue.data?.hasMore ?? false}
              copy={copy.count}
            />
          )}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">
          {filtering ? copy.listIntro : copy.intro}
        </p>

        <Suspense fallback={null}>
          <BackerTicketForm
            copy={copy.backerTicket}
            bankDetails={copy.bankDetails}
            subject={copy.ticketSubject}
            refusals={copy.refusals}
            onRaised={queue.reload}
          />
        </Suspense>

        {/*
          Three rows, because they are three independent questions and a reader combines them:
          "urgent things nobody has picked up" is one chip from each. Every chip reaches the
          service — a page of fifty narrowed in the browser would report a count about the page
          under a heading that reads as a count about the platform.
        */}
        <ChipRow aria-label={copy.stateFilterLabel} className="mt-4">
          <Chip active={!filtering} onClick={backToQueue}>
            {copy.queueOnly}
          </Chip>
          {TICKET_STATES.map((value) => (
            <Chip
              key={value}
              active={filter.state === value}
              onClick={() =>
                narrow({ ...filter, state: filter.state === value ? null : value })
              }
            >
              {copy.state[value]}
            </Chip>
          ))}
        </ChipRow>

        <ChipRow aria-label={copy.priorityFilterLabel} className="mt-2">
          <Chip active={filter.priority == null} onClick={() => narrow({ ...filter, priority: null })}>
            {copy.anyPriority}
          </Chip>
          {TICKET_PRIORITIES.map((value) => (
            <Chip
              key={value}
              active={filter.priority === value}
              onClick={() =>
                narrow({ ...filter, priority: filter.priority === value ? null : value })
              }
            >
              {copy.priority[value]}
            </Chip>
          ))}
        </ChipRow>

        <ChipRow aria-label={copy.assignmentFilterLabel} className="mt-2">
          <Chip
            active={filter.unassigned !== true && filter.assigneeId == null}
            onClick={() => showUnassigned(false)}
          >
            {copy.anyAssignee}
          </Chip>
          <Chip
            active={filter.unassigned === true}
            onClick={() => showUnassigned(filter.unassigned !== true)}
          >
            {copy.unassignedOnly}
          </Chip>
        </ChipRow>

        {/*
          #414's third answer, and the reason it is a picker rather than a chip.

          A chip per member of staff would be a row that grows with the team and orders itself
          by nothing a reader recognises. `AccountPicker` is the control the audit trail already
          reuses for its actor filter, with two of its words overridden — and it searches
          accounts rather than staff, which is acceptable because an assignee is an account.

          Not a "Mine" chip. That is the shorter route to "what is on my plate" and it needs
          something the console does not hand this screen: who is signed in. `/admin/staff`
          reads `GET /v1/admin/staff/me` for exactly that, and wiring a second screen to it is a
          decision about the console's shape rather than a filter — #414 says so, and this stops
          where that begins. A person can find themselves in the picker meanwhile.

          Outside the `ChipRow` because it is not a chip: it has a text field, a button of its
          own, and a result list, and a row that announces itself as a set of chips should not
          contain a search form.
        */}
        <AccountPicker
          chosen={assignee}
          onChoose={assignTo}
          copy={copy.assigneePicker}
          className="mt-3 max-w-[420px]"
        />

        {firstRead && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <div className="space-y-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                  <Skeleton height="1rem" width="45%" />
                  <Skeleton height="0.875rem" width="70%" className="mt-3" />
                </div>
              ))}
            </div>
          </SkeletonGroup>
        )}

        {queue.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {queue.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={queue.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {queue.status !== 'failed' && tickets !== null && tickets.length === 0 && (
          <EmptyState
            className="mt-4"
            /* A filtered list that is empty says nothing matched, not that there are no
               tickets — the distinction #404 draws about every list in the console. */
            variant={filtering ? 'filtered' : 'empty'}
            title={filtering ? copy.filteredTitle : copy.emptyTitle}
            description={filtering ? copy.filteredBody : copy.emptyBody}
          />
        )}

        {queue.status !== 'failed' && tickets !== null && tickets.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  onClick={() => setOpenTicket(openTicket === ticket.id ? null : ticket.id)}
                  aria-expanded={openTicket === ticket.id}
                  className="w-full rounded-lg border border-white/8 bg-surface-1 p-4 text-left transition-colors duration-150 ease-in-out hover:border-white/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-white">{ticket.subject}</p>
                    <span className="flex items-center gap-2">
                      <Tag variant={PRIORITY_TONE[ticket.priority]}>{copy.priority[ticket.priority]}</Tag>
                      <Tag>{copy.state[ticket.state]}</Tag>
                    </span>
                  </div>
                  <p className="mt-2 flex flex-wrap items-baseline gap-x-1 text-xs text-white/40">
                    {/*
                      #402: a ticket read as "7d09800a · 2026-08-22 · 4a10278a" — the person
                      who asked and the person handling it, neither of them nameable, on the
                      screen whose whole subject is a conversation between the two.
                    */}
                    <EntityName
                      id={ticket.requesterId}
                      names={names}
                      kind="account"
                      copy={copy.identity}
                    />
                    <span>· {formatDate(ticket.createdAt, locale)} ·</span>
                    {ticket.assigneeId == null ? (
                      <span>{copy.unassigned}</span>
                    ) : (
                      <>
                        {/* Two names on one line read as a pair; this says which is which. */}
                        <span>{copy.assigneePrefix}</span>
                        <EntityName
                          id={ticket.assigneeId}
                          names={names}
                          kind="account"
                          copy={copy.identity}
                        />
                      </>
                    )}
                  </p>
                </button>

                {openTicket === ticket.id && (
                  <TicketDetail ticketId={ticket.id} copy={copy} onChanged={queue.reload} />
                )}
              </li>
            ))}
          </ul>
        )}

        {tickets !== null && (page > 0 || (queue.data?.hasMore ?? false)) && (
          <div className="mt-4 flex gap-2">
            <Pill variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
              {copy.previous}
            </Pill>
            <Pill
              variant="ghost"
              size="sm"
              disabled={!(queue.data?.hasMore ?? false)}
              onClick={() => setPage((n) => n + 1)}
            >
              {copy.next}
            </Pill>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One ticket, its thread, who has it, and the rest of the account's history.
 *
 * <h2>A ticket can be picked up</h2>
 *
 * <p>The service has taken an assignee since #310 and the queue filters by one since #414, and
 * nothing on this screen ever set it: the only assignment control was "Put back in the queue",
 * offered on tickets nobody had. So every ticket stayed unassigned for ever, "Nobody yet" was
 * always the whole list, and a colleague's name in the filter always found nothing. "Take it"
 * assigns the reader; the picker beside it hands the ticket to somebody else.
 *
 * <h2>It stays open while it changes</h2>
 *
 * <p>The thread is re-read after every action, and the last answer stays on screen while it is,
 * so a reply does not blank the ticket to a skeleton and back.
 */
function TicketDetail({
  ticketId,
  copy,
  onChanged,
}: {
  readonly ticketId: string;
  readonly copy: SupportConsoleCopy;
  readonly onChanged: () => void;
}) {
  const locale = useRouteLocale();
  const { membership } = useConsoleMembership();
  const context = useConsoleResource(
    (signal) => readTicket(ticketId, signal),
    copy.ticketSubject,
    copy.refusals,
    [ticketId],
  );

  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const file = context.data?.file ?? null;

  /*
   * Everybody the thread mentions, by name: who wrote each message and who has the ticket.
   * Every staff message used to say "Staff", so a thread with two colleagues on it could not
   * say which of them had promised what.
   */
  const names = useDirectoryNames(
    file === null
      ? []
      : [
          file.ticket.requesterId,
          file.ticket.assigneeId ?? null,
          ...file.messages.map((message) => message.authorId),
        ].filter((id): id is string => id != null),
    file?.ticket.subjectType === 'PROJECT' && file.ticket.subjectRef != null ? [file.ticket.subjectRef] : [],
  );

  async function act(work: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
      context.reload();
      onChanged();
    } catch (cause) {
      setError(consoleMessageFor(cause, copy.ticketSubject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  if (file === null) {
    if (context.status === 'loading') {
      return (
        <SkeletonGroup label={copy.loadingTicket} className="mt-2 rounded-lg border border-white/8 p-4">
          <Skeleton height="0.875rem" width="60%" />
        </SkeletonGroup>
      );
    }

    return (
      <div className="mt-2">
        <InlineAlert variant="danger" title={copy.ticketFailedTitle}>
          {context.error ?? copy.tryAgainShort}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-3" onClick={context.reload}>
          {copy.tryAgain}
        </Pill>
      </div>
    );
  }

  const ticket = file.ticket;
  const history = context.data?.history ?? [];
  const others = history.filter((other) => other.id !== ticket.id);
  const pledgeId = ticket.subjectType === 'PLEDGE' && ticket.subjectRef != null ? ticket.subjectRef : null;
  const me = membership?.accountId ?? null;

  return (
    <div className="mt-2 rounded-lg border border-white/8 bg-surface-1 p-4" aria-busy={busy}>
      {/* What the conversation is about, when it is about something the console can show. */}
      {ticket.subjectType !== 'NONE' && ticket.subjectRef != null && (
        <p className="mb-3 flex flex-wrap items-baseline gap-x-2 text-xs text-white/48">
          <span>{copy.aboutLabel}:</span>
          <span className="text-white/64">{copy.about[ticket.subjectType] ?? ticket.subjectType}</span>
          {ticket.subjectType === 'ACCOUNT' && (
            <EntityName id={ticket.subjectRef} names={names} kind="account" copy={copy.identity} />
          )}
          {ticket.subjectType === 'PROJECT' && (
            <EntityName id={ticket.subjectRef} names={names} kind="project" copy={copy.identity} />
          )}
          {ticket.subjectType === 'PLEDGE' && (
            <>
              <span className="font-mono text-white/64" title={ticket.subjectRef}>
                {ticket.subjectRef.slice(0, 8)}
              </span>
              <CopyIdentifier id={ticket.subjectRef} copy={copy.identity} />
            </>
          )}
        </p>
      )}

      <ul className="flex list-none flex-col gap-2">
        {file.messages.map((message) => (
          <li
            key={message.id}
            className={
              message.internal
                ? 'rounded-md border border-dashed border-white/16 p-3'
                : 'rounded-md border border-white/8 p-3'
            }
          >
            <p className="flex flex-wrap items-baseline gap-x-1 text-xs text-white/40">
              {names.accounts.has(message.authorId) ? (
                <EntityName id={message.authorId} names={names} kind="account" copy={copy.identity} />
              ) : (
                <span>{message.authorSide === 'STAFF' ? copy.staff : copy.requester}</span>
              )}
              {message.internal && <span>· {copy.internalNote}</span>}
              <span>·</span>
              {/* The minute, not only the day: a conversation is read in order. */}
              <time dateTime={message.createdAt}>{formatExactTime(message.createdAt, locale)}</time>
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-white/80">{message.body}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-2 border-t border-white/8 pt-4">
        <Field label={copy.replyLabel}>
          <Textarea
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={20000}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            checked={internal}
            onChange={(event) => setInternal(event.target.checked)}
            label={copy.internalLabel}
          />
          <Pill
            variant="outline"
            size="sm"
            disabled={busy || body.trim() === ''}
            onClick={() =>
              void act(async () => {
                await replyToTicket(ticketId, body.trim(), internal);
                setBody('');
              })
            }
          >
            {copy.send}
          </Pill>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-white/8 pt-4">
        <Field label={copy.priorityLabel} className="min-w-[150px]">
          <Select
            value={ticket.priority}
            disabled={busy}
            onChange={(event) =>
              void act(() =>
                updateTicket(ticketId, { priority: event.target.value as TicketPriority }),
              )
            }
          >
            {TICKET_PRIORITIES.map((option) => (
              <option key={option} value={option}>
                {copy.priority[option]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={copy.stateLabel} className="min-w-[150px]">
          <Select
            value={ticket.state}
            disabled={busy}
            onChange={(event) =>
              void act(() => updateTicket(ticketId, { state: event.target.value as TicketState }))
            }
          >
            {TICKET_STATES.map((option) => (
              <option key={option} value={option}>
                {copy.state[option]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-4 border-t border-white/8 pt-4">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-white/64">
          <span>{copy.assigneePrefix}</span>
          {ticket.assigneeId == null ? (
            <span className="text-white/48">{copy.unassigned}</span>
          ) : (
            <EntityName id={ticket.assigneeId} names={names} kind="account" copy={copy.identity} />
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {me !== null && ticket.assigneeId !== me && (
            <Pill
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void act(() => updateTicket(ticketId, { assigneeId: me }))}
            >
              {copy.takeIt}
            </Pill>
          )}
          {/* Only on a ticket somebody has. Offered on one nobody had, it did nothing. */}
          {ticket.assigneeId != null && (
            <Pill
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void act(() => updateTicket(ticketId, { unassign: true }))}
            >
              {copy.putBack}
            </Pill>
          )}
        </div>

        {/* Keyed by the assignee, so a hand-over clears the search that made it. */}
        <AccountPicker
          key={ticket.assigneeId ?? 'nobody'}
          chosen={null}
          onChoose={(account: AdminUser | null) => {
            if (account !== null) void act(() => updateTicket(ticketId, { assigneeId: account.id }));
          }}
          copy={copy.handTo}
          disabled={busy}
          className="mt-3 max-w-[420px]"
        />
      </div>

      {pledgeId !== null && (
        <Suspense fallback={null}>
          <RefundBankDetailsForm
            pledgeId={pledgeId}
            ticketId={ticket.id}
            copy={copy.bankDetails}
            subject={copy.ticketSubject}
            refusals={copy.refusals}
          />
        </Suspense>
      )}

      {others.length > 0 && (
        <div className="mt-4 border-t border-white/8 pt-4">
          <h4 className="text-xs font-medium text-white/64">
            {pluralise(locale, copy.otherTickets, others.length)}
          </h4>
          <ul className="mt-2 flex list-none flex-col gap-1">
            {others.slice(0, 8).map((other: Ticket) => (
              <li key={other.id} className="text-xs text-white/48">
                {formatDate(other.createdAt, locale)} · {other.subject} · {copy.state[other.state]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}
    </div>
  );
}
