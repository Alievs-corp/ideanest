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
import type { SupportConsoleCopy } from '../../lib/i18n/admin/people-copy';
import { AccountPicker } from './AccountPicker';
import { ConsoleCount } from './ConsoleCount';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
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

export interface SupportConsoleProps {
  readonly copy: SupportConsoleCopy;
}

export function SupportConsole({ copy }: SupportConsoleProps) {
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

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.heading}
          {/*
            #404 again, in miniature: this badge printed the length of the loaded page as
            though it were the population, which is the defect `ConsoleCount` exists for. The
            list pages rather than cursors, so "there are more" comes from `hasMore` — the same
            fact the pager below is built on, and the two can no longer disagree.
          */}
          {queue.status === 'ready' && (
            <ConsoleCount
              loaded={queue.data?.tickets.length ?? 0}
              more={queue.data?.hasMore ?? false}
              copy={copy.count}
            />
          )}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.intro}</p>

        {/*
          Three rows, because they are three independent questions and a reader combines them:
          "urgent things nobody has picked up" is one chip from each. Every chip reaches the
          service — a page of fifty narrowed in the browser would report a count about the page
          under a heading that reads as a count about the platform.
        */}
        <ChipRow aria-label={copy.stateFilterLabel} className="mt-4">
          <Chip active={!filtering} onClick={() => narrow({})}>
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

        {queue.status === 'loading' && (
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

        {queue.status === 'ready' && queue.data !== null && queue.data.tickets.length === 0 && (
          <EmptyState
            className="mt-4"
            /* A filtered list that is empty says nothing matched, not that there are no
               tickets — the distinction #404 draws about every list in the console. */
            variant={filtering ? 'filtered' : 'empty'}
            title={filtering ? copy.filteredTitle : copy.emptyTitle}
            description={filtering ? copy.filteredBody : copy.emptyBody}
          />
        )}

        {queue.status === 'ready' && queue.data !== null && queue.data.tickets.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {queue.data.tickets.map((ticket) => (
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
                      <Tag>{copy.priority[ticket.priority]}</Tag>
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
                    <span>· {ticket.createdAt.slice(0, 10)} ·</span>
                    {ticket.assigneeId == null ? (
                      <span>{copy.unassigned}</span>
                    ) : (
                      <EntityName
                        id={ticket.assigneeId}
                        names={names}
                        kind="account"
                        copy={copy.identity}
                      />
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

        {queue.status === 'ready' && (page > 0 || (queue.data?.hasMore ?? false)) && (
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

/** One ticket, its thread, and the rest of the account's history. */
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

  if (context.status === 'loading') {
    return (
      <SkeletonGroup label={copy.loadingTicket} className="mt-2 rounded-lg border border-white/8 p-4">
        <Skeleton height="0.875rem" width="60%" />
      </SkeletonGroup>
    );
  }

  if (context.status !== 'ready' || context.data === null) {
    return (
      <InlineAlert variant="danger" title={copy.ticketFailedTitle} className="mt-2">
        {context.error ?? copy.tryAgainShort}
      </InlineAlert>
    );
  }

  const { file, history } = context.data;
  const others = history.filter((other) => other.id !== file.ticket.id);
  const pledgeId =
    file.ticket.subjectType === 'PLEDGE' && file.ticket.subjectRef != null ? file.ticket.subjectRef : null;

  return (
    <div className="mt-2 rounded-lg border border-white/8 bg-surface-1 p-4">
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
            <p className="text-xs text-white/40">
              {message.authorSide === 'STAFF' ? copy.staff : copy.requester}
              {message.internal ? ` · ${copy.internalNote}` : ''} ·{' '}
              {message.createdAt.slice(0, 10)}
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
            value={file.ticket.priority}
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
            value={file.ticket.state}
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

        <Pill
          variant="ghost"
          size="sm"
          className="mb-1"
          disabled={busy}
          onClick={() => void act(() => updateTicket(ticketId, { unassign: true }))}
        >
          {copy.putBack}
        </Pill>
      </div>

      {pledgeId !== null && (
        <Suspense fallback={null}>
          <RefundBankDetailsForm
            pledgeId={pledgeId}
            ticketId={file.ticket.id}
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
                {other.createdAt.slice(0, 10)} · {other.subject} · {copy.state[other.state]}
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
