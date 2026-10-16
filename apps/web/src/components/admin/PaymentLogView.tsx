'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Chip,
  ChipRow,
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Tag,
  TextInput,
} from '@ideanest/ui';
import {
  PAYMENT_PAGE_SIZE,
  TRANSACTION_STATUSES,
  isUuid,
  readPaymentLog,
  statusVariant,
  type LoggedTransaction,
  type TransactionStatus,
} from '../../lib/admin/payments';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  shortId,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import { formatMoney } from '../../lib/money';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import type { PaymentLogCopy } from '../../lib/i18n/admin/money-copy';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatExactTime } from '../../lib/time';
import type { Locale } from '../../lib/i18n/locale';
import type { DirectoryNames } from '../../lib/admin/directory';
import { ConsoleCount } from './ConsoleCount';
import { ConsoleRefusal } from './ConsoleRefusal';
import { CopyIdentifier, EntityName } from './ConsoleIdentity';
import { useDirectoryNames } from './useDirectoryNames';

/** Which of the two identifiers the search box is holding. */
type Scope = 'pledge' | 'project';

/**
 * §4.11's AD-05: every charge, its provider reference, and its state history — issue #304.
 *
 * <h2>The state history is the list, not a column on a row</h2>
 *
 * §7.2 makes `transactions` append-only, so a charge that was pending and later succeeded is
 * two rows sharing an idempotency key rather than one row that changed. This screen therefore
 * shows attempts and not payments: four rows for one pledge is a card that was refused three
 * times and collected on the fourth, and that sequence is exactly what §9.6's retry schedule
 * is argued from. Collapsing them into one line per pledge would delete the only thing here
 * that answers "why was this person charged on a Thursday".
 *
 * <h2>Newest first, and now it actually is — issue #412</h2>
 *
 * This screen renders `createdAt` and the service ordered by the primary key, on the argument
 * that a UUID v7 carries the millisecond it was minted in (§7.3). The two are written by two
 * different clocks — the key in the application when the row is built, `created_at` by
 * `DEFAULT now()` when the insert lands — so the column shown here and the column sorted on
 * could disagree, and #404 had already found what that cost on the audit trail.
 *
 * It costs more here. These rows are retry attempts against somebody's card and the order is
 * the evidence: §9.6 permits four collection attempts, and "declined, declined, collected"
 * read in the wrong order is a different story about the same pledge. Within one pledge
 * `attemptNumber` disambiguates them; the unfiltered log, which is what this screen opens on,
 * has nothing to fall back on.
 *
 * Nothing here changed for it. The cursor was already carried through as an opaque string and
 * handed back untouched — it is now a pair rather than an identifier, and this screen is the
 * proof that opacity was worth having.
 *
 * <h2>The search is a form, not a keystroke handler</h2>
 *
 * Every read of this log is audited — it hands somebody's payment history to an account with
 * no relationship to it — so a request per character would write a row per keystroke into the
 * one table with no retention rule. `UserDirectory` made the same decision for the same
 * reason.
 *
 * What is typed is checked before it is sent. Anything that is not a whole UUID used to reach
 * the service, which answers with Spring's own English "Failed to convert 'projectId'…" and no
 * code to translate it by — and "Try again" sent the same string again.
 *
 * <h2>A later page belongs to the question that asked for it</h2>
 *
 * "Load more" is a second request racing the first. Changing the identifier or the outcome
 * while it was in flight used to append the previous question's rows, and its cursor, to the
 * new list — a page of failures under a "succeeded" chip. The pending load-more is now aborted
 * when the question changes, and anything it brings back afterwards is dropped.
 *
 * <h2>Money is formatted, never computed</h2>
 *
 * The amount arrives as a string because §10.3 forbids a JSON number for money, and nothing
 * on this screen adds two of them up. `lib/money.ts` formats against the currency on the row,
 * which is the campaign's and never the reader's.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 puts motion at its lowest as money gets closer, and this is the
 * screen that is entirely money. 150ms of colour on a control, and nothing else.
 */
export interface PaymentLogViewProps {
  readonly copy: PaymentLogCopy;
}

export function PaymentLogView({ copy }: PaymentLogViewProps) {
  const locale = useRouteLocale();
  const ids = useId();
  const [status, setStatus] = useState<ConsoleStatus>('loading');
  // #400: which of the two 403s this is. Only read while `status` is `forbidden`.
  const [capability, setCapability] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('project');
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState<{ scope: Scope; id: string } | null>(null);
  /** What was typed is not a UUID. Shown under the box, and nothing is sent. */
  const [idError, setIdError] = useState<string | null>(null);
  /*
   * #404: which outcome, or every outcome. Chips rather than part of the form above, because
   * this filter is not a search — there is nothing to type and nothing to submit, and a
   * three-way choice behind a button is a click somebody forgets to make. It is also the
   * question this screen is opened with, where the identifier is the question it is narrowed
   * with, so it belongs above the results rather than inside the lookup.
   */
  const [outcome, setOutcome] = useState<TransactionStatus | null>(null);
  const [rows, setRows] = useState<readonly LoggedTransaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** The load-more in flight, so a new question can abort it and ignore what it returns. */
  const more = useRef<AbortController | null>(null);

  const filter = submitted;

  /* Which campaign each provider call was about — #402. */
  const names = useDirectoryNames([], rows.map((row) => row.projectId));

  useEffect(() => {
    const controller = new AbortController();

    // A new question: whatever the previous one was still loading is not part of it.
    more.current?.abort();
    more.current = null;
    setLoadingMore(false);

    async function load(): Promise<void> {
      setStatus('loading');
      try {
        const page = await readPaymentLog({
          pledgeId: filter?.scope === 'pledge' ? filter.id : null,
          projectId: filter?.scope === 'project' ? filter.id : null,
          status: outcome,
          limit: PAYMENT_PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setRows(page.transactions);
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
    // The copy is one object per server render — see `useConsoleResource` for the argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, outcome, attempt]);

  // Leaving the screen abandons a load-more as well as the first page.
  useEffect(() => () => more.current?.abort(), []);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || more.current !== null) return;

    const controller = new AbortController();
    more.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await readPaymentLog({
        pledgeId: filter?.scope === 'pledge' ? filter.id : null,
        projectId: filter?.scope === 'project' ? filter.id : null,
        status: outcome,
        after: cursor,
        limit: PAYMENT_PAGE_SIZE,
        signal: controller.signal,
      });
      // The question changed while this page was on its way: it is not a page of this list.
      if (controller.signal.aborted) return;
      setRows((previous) => [...previous, ...page.transactions]);
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
  }, [cursor, filter, outcome, copy]);

  if (status === 'signed-out' || status === 'forbidden') {
    return <ConsoleRefusal status={status} capability={capability} subject={copy.subject} copy={copy.refusals} />;
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const trimmed = term.trim();
    if (trimmed === '') {
      setIdError(null);
      setSubmitted(null);
      return;
    }
    if (!isUuid(trimmed)) {
      setIdError(copy.invalidId);
      return;
    }
    setIdError(null);
    setSubmitted({ scope, id: trimmed.toLowerCase() });
  }

  /*
   * The radio names what the submitted identifier is, so changing it after a search asks the
   * question again. Leaving the results in place would show a campaign's calls under a
   * selected "pledge", with nothing on screen saying which of the two was searched.
   */
  function chooseScope(option: Scope): void {
    setScope(option);
    if (submitted !== null && submitted.scope !== option) {
      setSubmitted({ scope: option, id: submitted.id });
    }
  }

  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;

  return (
    <section aria-labelledby="payment-log-heading">
      <h2 id="payment-log-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.heading}
        {status === 'ready' && (
          <ConsoleCount loaded={rows.length} more={cursor !== null} copy={copy.count} />
        )}
      </h2>

      {/*
        The hint and the error sit under the whole row rather than inside the field. Inside,
        they made the field taller than the controls beside it, and `items-end` then lined the
        radios and the button up with the hint instead of with the box.
      */}
      <form onSubmit={submit} className="mt-4" noValidate>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <Field label={copy.identifierLabel} className="min-w-[min(100%,280px)] flex-1">
            <TextInput
              type="search"
              value={term}
              invalid={idError !== null}
              aria-describedby={idError === null ? hintId : `${hintId} ${errorId}`}
              onChange={(event) => {
                setTerm(event.target.value);
                setIdError(null);
              }}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>

          {/* As tall as the input, so everything in it is centred on the box. */}
          <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
            {/*
              Two radio buttons rather than a guess. Both identifiers are UUIDs and nothing
              about the string says which one it is, so a screen that inferred would sometimes
              ask the service for a campaign that is a pledge and answer with an empty page —
              which on this surface reads as "nothing was ever charged".
            */}
            <fieldset className="flex items-center gap-4">
              <legend className="sr-only">{copy.scopeLegend}</legend>
              {(['project', 'pledge'] as const).map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-white/64">
                  <input
                    type="radio"
                    name="payment-scope"
                    value={option}
                    checked={scope === option}
                    onChange={() => chooseScope(option)}
                    className="accent-[var(--lime-500)]"
                  />
                  {option === 'project' ? copy.scopeProject : copy.scopePledge}
                </label>
              ))}
            </fieldset>

            <div className="flex items-center gap-2">
              <Pill type="submit" variant="outline" size="sm">
                {copy.search}
              </Pill>
              {submitted !== null && (
                <Pill
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTerm('');
                    setIdError(null);
                    setSubmitted(null);
                  }}
                >
                  {copy.clear}
                </Pill>
              )}
            </div>
          </div>
        </div>

        <p id={hintId} className="mt-1.5 text-[13px] text-white/64">
          {copy.identifierHint}
        </p>
        {idError !== null && (
          <p id={errorId} role="alert" className="mt-1 text-[13px] text-danger">
            {idError}
          </p>
        )}
      </form>

      {/*
        #404: the outcome, and every chip reaches the service. The screen's own description
        promises the log includes rejected calls, and until V63 there was no index that could
        select them — so the view an operator opens this screen for was the one view it could
        not offer. Narrowing the loaded page in the browser would have been the cheap version
        and a wrong one: "3 results" about a page of twenty-five is not an answer about a table
        with four thousand failures in it. `AuditTrailView` states the same rule.
      */}
      <ChipRow aria-label={copy.outcomeLabel} className="mt-3">
        <Chip active={outcome === null} onClick={() => setOutcome(null)}>
          {copy.everyOutcome}
        </Chip>
        {TRANSACTION_STATUSES.map((value) => (
          <Chip key={value} active={outcome === value} onClick={() => setOutcome(value)}>
            {copy.status[value]}
          </Chip>
        ))}
      </ChipRow>

      {error && (
        <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="space-y-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="40%" />
                <Skeleton height="0.875rem" width="65%" className="mt-3" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && rows.length === 0 && (
        <EmptyState
          className="mt-4"
          /* An outcome chip narrows the list exactly as the identifier does, so a page of
             nothing under one is "no failures", not "no provider calls" — #404. */
          variant={submitted === null && outcome === null ? 'empty' : 'filtered'}
          title={submitted === null && outcome === null ? copy.emptyTitle : copy.filteredTitle}
          description={
            submitted === null && outcome === null ? copy.emptyBody : copy.filteredBody
          }
        />
      )}

      {status === 'ready' && rows.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-2">
          {rows.map((row) => (
            <TransactionRow
              key={row.id}
              transaction={row}
              locale={locale}
              names={names}
              copy={copy}
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
    </section>
  );
}

/**
 * One call to a provider.
 *
 * <p><strong>The provider reference is printed in full, not shortened.</strong> Every other
 * identifier on the console's screens is cut to eight characters because nobody reads them —
 * this one is the string a support conversation and a dispute are both conducted in, so it is
 * the one thing on the row somebody copies. It wraps rather than truncates for the same
 * reason: half a reference is worse than a long one.
 *
 * <p><strong>One layout, whatever the text.</strong> The amount and the type lead the first
 * line, and the provider, the outcome and the time sit to its right from `sm` up. They used to
 * wrap underneath or not depending on how long the line beside them was, so two rows of one
 * list looked like two different screens. Below `sm` they always stack under it.
 *
 * <p>A refusal is said in the reader's language, from the code the service wrote. A code this
 * screen has no sentence for — a card network's own reason — is printed as it came beside a
 * plain "refused", and the provider's English message stays on the `title` for whoever has to
 * quote it.
 */
function TransactionRow({
  names,
  transaction,
  locale,
  copy,
}: {
  readonly transaction: LoggedTransaction;
  readonly names: DirectoryNames;
  readonly locale: Locale;
  readonly copy: PaymentLogCopy;
}) {
  const reference = transaction.providerTransactionId;
  const code = transaction.failureCode;
  const failure = code == null || code === '' ? null : (copy.failure[code] ?? null);

  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p className="min-w-0 text-[15px] font-medium text-white">
          {formatMoney(transaction.amount)}{' '}
          <span className="font-normal text-white/48">{copy.type[transaction.type]}</span>
        </p>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Tag>{copy.provider[transaction.provider] ?? transaction.provider}</Tag>
          <Tag variant={statusVariant(transaction.status)}>
            {copy.status[transaction.status]}
          </Tag>
          <time
            dateTime={transaction.createdAt}
            className="text-xs text-white/40"
            title={transaction.createdAt}
          >
            {formatExactTime(transaction.createdAt, locale)}
          </time>
        </div>
      </div>

      <p className="mt-1 text-sm text-white/64">
        {/*
          Three fragments joined by a separator rather than one template with two optional
          holes: the pledge is absent on a payout, and a sentence built around it would
          leave a stray dot behind.
        */}
        {fillNodes(copy.campaignPart, {
          id: (
            <EntityName
              id={transaction.projectId}
              names={names}
              kind="project"
              copy={copy.identity}
            />
          ),
        })}
        {transaction.pledgeId != null && (
          <>
            {' · '}
            {fillNodes(copy.pledgePart, {
              id: (
                <span className="inline-flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono" title={transaction.pledgeId}>
                    {shortId(transaction.pledgeId)}
                  </span>
                  {/*
                    #402: `/admin/refunds` takes a full pledge identifier typed by hand
                    and this is the only console screen that lists pledges at all. Every
                    identifier the console asks somebody to type is now copyable from the
                    screen that supplies it.
                  */}
                  <CopyIdentifier id={transaction.pledgeId} copy={copy.identity} />
                </span>
              ),
            })}
          </>
        )}
        {' · '}
        {fillPlaceholders(copy.attemptPart, {
          number: String(transaction.attemptNumber),
        })}
      </p>

      {reference != null && reference !== '' ? (
        <p className="mt-2 break-all font-mono text-xs text-white/40">{reference}</p>
      ) : (
        /*
          A pending or failed call with no reference may be a request that never got an
          answer — a timeout — and it is on the row precisely because it may have charged
          somebody without the platform knowing. A succeeded one plainly reached the
          provider, and saying it "may have" would be absurd, so it only notes the gap.
        */
        <p className="mt-2 text-xs text-white/40">
          {transaction.status === 'SUCCEEDED' ? copy.noReferenceSettled : copy.noReference}
        </p>
      )}

      {code != null && code !== '' && (
        <p className="mt-2 text-sm text-white/64" title={transaction.failureMessage ?? undefined}>
          {failure ?? (
            <>
              {copy.failureUnknown}{' '}
              <span className="font-mono text-white/48">{code}</span>
            </>
          )}
        </p>
      )}
    </li>
  );
}
