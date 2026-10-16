'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { EmptyState, Field, InlineAlert, Pill, Select, Skeleton, SkeletonGroup, TextInput } from '@ideanest/ui';
import {
  PAYMENT_METHODS,
  exportSubscriptionPayments,
  readRevenue,
  readSubscriptionPayments,
  type PaymentMethod,
  type RevenueReport,
  type RevenueRequest,
  type SubscriptionPayment,
} from '../../lib/admin/revenue';
import { consoleMessageFor, wasAborted } from '../../lib/admin/refusals';
import { ApiError } from '../../lib/api/problem';
import { formatMoney } from '../../lib/money';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import type { RevenueReportCopy } from '../../lib/i18n/admin/money-copy';
import type { Locale } from '../../lib/i18n/locale';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate, formatExactTime } from '../../lib/time';
import { ConsoleCount } from './ConsoleCount';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * AD-11's third screen: what the subscriptions brought in — #23.
 *
 * <h2>Figures first, rows behind them, and the file is what is on screen</h2>
 *
 * The totals, the breakdowns and the payment list are all one question — the period and the
 * filters at the top — so they reload together and the export sends exactly that question.
 * A figure above a list that answered something slightly different would be a figure nobody
 * could reconcile against the rows under it.
 *
 * <h2>Three figures per currency, never a grand total</h2>
 *
 * Received, reversed and kept, because a single net cannot be checked against a bank
 * statement and a single gross overstates what the platform kept. There is no line adding
 * currencies together, for §21.2's reason; the service does not send one either.
 *
 * <h2>Days are Baku's days</h2>
 *
 * The two date fields name calendar days in `Asia/Baku`, the zone the service's default month
 * uses, and the end day is <em>included</em> — somebody asking for "1 to 30 September" means
 * the 30th. So the request carries the start of the first day and the start of the day after
 * the last, both at `+04:00`. A fixed offset rather than a zone lookup, because Azerbaijan has
 * not observed daylight saving since 2016 and `Intl` offers no way to build an instant from a
 * zone name without a library.
 *
 * <h2>No motion</h2>
 *
 * docs/motion-system.md §5: motion decreases as money gets closer, and this screen is money
 * after it has arrived. Nothing here animates.
 */
export interface RevenueReportViewProps {
  readonly copy: RevenueReportCopy;
  /**
   * Hands a finished file to the browser. Injected for tests, which have no object URLs, and
   * defaulted to {@link offerDownload} everywhere else.
   */
  readonly offerFile?: (filename: string, csv: string) => void;
}

const BAKU_OFFSET = '+04:00';
const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

/** The calendar day an instant falls on in Baku, as `YYYY-MM-DD`. */
function bakuDay(iso: string): string {
  return new Date(Date.parse(iso) + BAKU_OFFSET_MS).toISOString().slice(0, 10);
}

/** The first instant of a Baku day, as the service reads it. */
function startOfBakuDay(day: string): string {
  return `${day}T00:00:00${BAKU_OFFSET}`;
}

function shiftDay(day: string, by: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + by);
  return at.toISOString().slice(0, 10);
}

/** The first and last day of a month relative to today in Baku: 0 is this month, -1 the last. */
function monthDays(offset: number, now: Date = new Date()): { readonly from: string; readonly to: string } {
  const [year = 1970, month = 1] = bakuDay(now.toISOString()).split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(year, month + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * A Baku day in words.
 *
 * Formatted at noon UTC, which is the same calendar day in every zone from UTC−11 to UTC+11,
 * so a reader whose browser is not in Baku still sees the day the period is about.
 */
function dayInWords(day: string, locale: Locale): string {
  return formatDate(`${day}T12:00:00Z`, locale);
}

function moneyOf(amount: string, currency: string): string {
  return formatMoney({ amount, currency });
}

/**
 * Hands the file to the browser.
 *
 * An object URL and a synthetic click, because the route needs a bearer token and a link
 * cannot carry one — `BackerReport` does the same for the same reason. Revoked at once: it
 * holds the whole subscriber list alive in the tab for as long as it exists.
 */
function offerDownload(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The longest period the service reports on, in days — `RevenuePeriod.MAX_DAYS`. */
const MAX_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a period cannot be reported on, in the reader's words, or null when it can.
 *
 * Checked before sending, so the reader is told at the field rather than by a refusal, and
 * used again to word the service's own `INVALID_REVENUE_PERIOD` — which carries only an English
 * `detail`, and is told apart here by the request that earned it rather than by its prose.
 */
function periodProblem(
  from: string | null | undefined,
  to: string | null | undefined,
  copy: RevenueReportCopy,
): string | null {
  if (from == null || to == null) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end <= start) return copy.periodBackwards;
  if (end - start > MAX_DAYS * DAY_MS) return copy.periodTooLong;
  return null;
}

export function RevenueReportView({ copy, offerFile }: RevenueReportViewProps) {
  const locale = useRouteLocale();
  const ids = useId();

  /* ---- the question ------------------------------------------------------ */

  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [planCode, setPlanCode] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  /** What was last asked. Empty on arrival, which the service answers with this month. */
  const [request, setRequest] = useState<RevenueRequest>({});
  /** The period as typed cannot be asked about. Shown under the dates; nothing is sent. */
  const [periodError, setPeriodError] = useState<string | null>(null);

  /*
   * The service's refusal of a period arrives with an English `detail` and nothing else to
   * translate it by. It is reworded here, before `useConsoleResource` turns it into the
   * message on screen, from the request it refused.
   */
  const inReadersWords = (cause: unknown): unknown => {
    if (!(cause instanceof ApiError) || cause.problem?.code !== 'INVALID_REVENUE_PERIOD') return cause;
    const detail = periodProblem(request.from, request.to, copy) ?? copy.periodBackwards;
    return new ApiError(cause.status, { ...cause.problem, detail });
  };

  const report = useConsoleResource(
    (signal) =>
      readRevenue(request, signal).catch((cause: unknown) => {
        throw inReadersWords(cause);
      }),
    copy.subject,
    copy.refusals,
    [request],
  );
  const firstPage = useConsoleResource(
    (signal) =>
      readSubscriptionPayments(request, {}, signal).catch((cause: unknown) => {
        throw inReadersWords(cause);
      }),
    copy.subject,
    copy.refusals,
    [request],
  );

  /*
   * The fields start empty and are filled from the period the service chose — once, and only if
   * the reader has not touched them first.
   *
   * Both halves matter. Refilling on every answer would overwrite a date somebody is halfway
   * through typing; so would filling once if the first answer arrives while they are typing,
   * which on a slow connection is the ordinary case rather than the edge one. A half-typed
   * date input overwritten mid-keystroke does not keep either value — it sanitises to empty,
   * and the request then goes out with no start date and the reader's end date, a period
   * nobody asked for. The component test reproduces exactly that sequence.
   */
  const filled = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (filled.current || touched.current || report.data === null) return;
    filled.current = true;
    setFromDay(bakuDay(report.data.from));
    setToDay(bakuDay(new Date(Date.parse(report.data.to) - 1).toISOString()));
  }, [report.data]);

  const editFrom = (value: string) => {
    touched.current = true;
    setFromDay(value);
    setPeriodError(null);
  };
  const editTo = (value: string) => {
    touched.current = true;
    setToDay(value);
    setPeriodError(null);
  };

  const ask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: RevenueRequest = {
      from: fromDay === '' ? null : startOfBakuDay(fromDay),
      // Inclusive on screen, exclusive on the wire: the start of the day after the last one.
      to: toDay === '' ? null : startOfBakuDay(shiftDay(toDay, 1)),
      planCode: planCode.trim() === '' ? null : planCode.trim(),
      method: method === '' ? null : method,
    };
    const problem = periodProblem(next.from, next.to, copy);
    if (problem !== null) {
      setPeriodError(problem);
      return;
    }
    setPeriodError(null);
    setRequest(next);
  };

  const pickMonth = (offset: number) => {
    const days = monthDays(offset);
    touched.current = true;
    setFromDay(days.from);
    setToDay(days.to);
    setPeriodError(null);
  };

  /* ---- the list's later pages ------------------------------------------- */

  const [more, setMore] = useState<readonly SubscriptionPayment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  /** The load-more in flight, so a new question can abort it and ignore what it returns. */
  const pending = useRef<AbortController | null>(null);

  /*
   * A new question starts the list again, at once and not when its first page arrives. Waiting
   * for the answer left the previous question's pages and cursor in place while it loaded — and
   * for good when it failed — so "load more" could send the new question with the old cursor.
   */
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setLoadingMore(false);
    setMore([]);
    setListError(null);
    setCursor(null);
  }, [request]);

  // The cursor is the answered first page's, and only once it is this question's answer.
  useEffect(() => {
    if (firstPage.status !== 'ready') return;
    setMore([]);
    setCursor(firstPage.data?.nextCursor ?? null);
  }, [firstPage.status, firstPage.data]);

  useEffect(() => () => pending.current?.abort(), []);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || pending.current !== null) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoadingMore(true);
    setListError(null);
    try {
      const page = await readSubscriptionPayments(request, { after: cursor }, controller.signal);
      // The question changed while this page was on its way: it is not a page of this list.
      if (controller.signal.aborted) return;
      setMore((held) => [...held, ...page.payments]);
      setCursor(page.nextCursor ?? null);
    } catch (cause) {
      if (controller.signal.aborted || wasAborted(cause)) return;
      setListError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoadingMore(false);
      }
    }
    // The copy is one object per server render — see `useConsoleResource` for the argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, request]);

  /* ---- the file ---------------------------------------------------------- */

  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ readonly text: string; readonly short: boolean } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const download = async () => {
    setExporting(true);
    setExportNotice(null);
    setExportError(null);
    try {
      const file = await exportSubscriptionPayments(request);
      (offerFile ?? offerDownload)(file.filename, file.csv);
      setExportNotice(
        file.truncated
          ? { text: fillPlaceholders(copy.truncated, { count: String(file.rows) }), short: true }
          : { text: pluralise(locale, copy.exported, file.rows), short: false },
      );
    } catch (cause) {
      setExportError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setExporting(false);
    }
  };

  /* ---- drawing ------------------------------------------------------------ */

  if (report.status === 'signed-out' || report.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={report.status}
        capability={report.capability}
        subject={copy.subject}
        copy={copy.refusals}
      />
    );
  }

  /*
   * Only the answer to the question on screen is drawn. `useConsoleResource` keeps the previous
   * answer through a reload, which suits a refresh and not a new question: September's totals
   * under an October request that is still loading, or that failed, are figures somebody will
   * read as October's.
   */
  const busy = report.status === 'loading' || firstPage.status === 'loading';
  const data: RevenueReport | null = report.status === 'ready' ? report.data : null;
  const listReady = firstPage.status === 'ready';
  const rows = listReady ? [...(firstPage.data?.payments ?? []), ...more] : [];
  const lastDay = data === null ? null : bakuDay(new Date(Date.parse(data.to) - 1).toISOString());
  const filtered = request.planCode != null || request.method != null;
  // Both reads refused for the same reason say it once, above the figures.
  const listFailed = firstPage.status === 'failed' && report.status !== 'failed';
  const retry = () => {
    report.reload();
    firstPage.reload();
  };

  const periodHintId = `${ids}-period-hint`;
  const periodErrorId = `${ids}-period-error`;
  const planHintId = `${ids}-plan-hint`;

  return (
    <div className="flex flex-col gap-8">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      {/* ---- the question -------------------------------------------------- */}

      {/*
        Hints sit under each row rather than inside a field. Inside, a field with a hint was
        taller than the one beside it, and `items-end` then lifted its label above its
        neighbour's and lined the buttons up with the hint instead of with the boxes. Every
        control in a row now ends on the same line, and the presets and the submit button are
        as tall as an input so they centre on it.
      */}
      <form onSubmit={ask} className="flex flex-col gap-5" noValidate>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-white">{copy.periodLegend}</legend>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={copy.fromLabel} className="w-[calc(50%-0.375rem)] sm:w-44">
              <TextInput
                type="date"
                value={fromDay}
                invalid={periodError !== null}
                aria-describedby={periodError === null ? periodHintId : `${periodHintId} ${periodErrorId}`}
                onChange={(event) => editFrom(event.target.value)}
              />
            </Field>
            <Field label={copy.toLabel} className="w-[calc(50%-0.375rem)] sm:w-44">
              <TextInput
                type="date"
                value={toDay}
                invalid={periodError !== null}
                aria-describedby={periodError === null ? periodHintId : `${periodHintId} ${periodErrorId}`}
                onChange={(event) => editTo(event.target.value)}
              />
            </Field>
            <div className="flex min-h-11 items-center gap-2">
              <Pill type="button" variant="ghost" size="sm" onClick={() => pickMonth(0)}>
                {copy.thisMonth}
              </Pill>
              <Pill type="button" variant="ghost" size="sm" onClick={() => pickMonth(-1)}>
                {copy.lastMonth}
              </Pill>
            </div>
          </div>
          <p id={periodHintId} className="mt-1.5 text-[13px] text-white/64">
            {copy.toHint}
          </p>
          {periodError !== null && (
            <p id={periodErrorId} role="alert" className="mt-1 text-[13px] text-danger">
              {periodError}
            </p>
          )}
        </fieldset>

        <div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={copy.planLabel} className="w-full sm:w-52">
              <TextInput
                value={planCode}
                aria-describedby={planHintId}
                onChange={(event) => setPlanCode(event.target.value)}
                maxLength={40}
              />
            </Field>
            <Field label={copy.methodLabel} className="w-full sm:w-56">
              <Select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod | '')}>
                <option value="">{copy.anyMethod}</option>
                {PAYMENT_METHODS.map((option) => (
                  <option key={option} value={option}>
                    {copy.method[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex min-h-11 items-center">
              {/* Disabled while a question is out, and says so: a second click is a second audit row. */}
              <Pill type="submit" size="sm" disabled={busy} aria-busy={busy}>
                {busy ? copy.loading : copy.show}
              </Pill>
            </div>
          </div>
          <p id={planHintId} className="mt-1.5 text-[13px] text-white/64">
            {copy.planHint}
          </p>
        </div>
      </form>

      {/* ---- the figures --------------------------------------------------- */}

      <section aria-labelledby={`${ids}-totals`} aria-busy={report.status === 'loading'}>
        <h2 id={`${ids}-totals`} className="text-lg font-semibold text-white">
          {copy.totalsHeading}
        </h2>
        {data !== null && lastDay !== null && (
          <p className="mt-1 text-sm text-white/64">
            {fillPlaceholders(copy.periodCaption, {
              from: dayInWords(bakuDay(data.from), locale),
              to: dayInWords(lastDay, locale),
            })}
          </p>
        )}

        {report.status === 'loading' && (
          <SkeletonGroup label={copy.loadingTotals} className="mt-4">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="0.875rem" width="60%" className="mt-3" />
          </SkeletonGroup>
        )}

        {report.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {report.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={retry}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {data !== null && data.currencies.length === 0 && (
          /* A plan code or a method narrows the period exactly as the dates do, so nothing under
             one is "nothing matches", not "nothing was paid". */
          <EmptyState
            className="mt-4"
            variant={filtered ? 'filtered' : 'empty'}
            title={filtered ? copy.filteredTitle : copy.emptyTitle}
            description={filtered ? copy.filteredBody : copy.emptyBody}
          />
        )}

        {data !== null && data.currencies.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-3">
            {data.currencies.map((total) => (
              <li key={total.currency} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-white/64">{copy.gross}</dt>
                    <dd className="font-mono text-base tabular-nums text-white">
                      {moneyOf(total.gross, total.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/64">{copy.reversed}</dt>
                    <dd className="font-mono text-base tabular-nums text-white">
                      {moneyOf(total.reversed, total.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/64">{copy.net}</dt>
                    <dd className="font-mono text-base font-semibold tabular-nums text-white">
                      {moneyOf(total.net, total.currency)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-white/64">
                  {pluralise(locale, copy.payments, total.payments)} ·{' '}
                  {pluralise(locale, copy.reversals, total.reversals)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data !== null && data.plans.length > 0 && (
        <section aria-labelledby={`${ids}-plans`}>
          <h2 id={`${ids}-plans`} className="text-lg font-semibold text-white">
            {copy.byPlanHeading}
          </h2>
          <ul className="mt-4 flex list-none flex-col gap-2">
            {data.plans.map((plan) => (
              <li
                key={`${plan.planCode}-${plan.planName}-${plan.currency}-${plan.billingPeriod}`}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg border border-white/8 bg-surface-1 px-4 py-3"
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <span className="text-[15px] font-medium text-white">{plan.planName}</span>
                  <span className="font-mono text-xs text-white/64">{plan.planCode}</span>
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="text-xs text-white/64">{pluralise(locale, copy.entries, plan.entries)}</span>
                  <span className="font-mono tabular-nums text-white">{moneyOf(plan.net, plan.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data !== null && data.methods.length > 0 && (
        <section aria-labelledby={`${ids}-methods`}>
          <h2 id={`${ids}-methods`} className="text-lg font-semibold text-white">
            {copy.byMethodHeading}
          </h2>
          <ul className="mt-4 flex list-none flex-col gap-2">
            {data.methods.map((row) => (
              <li
                key={`${row.method}-${row.currency}`}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg border border-white/8 bg-surface-1 px-4 py-3"
              >
                <span className="text-[15px] text-white">{copy.method[row.method]}</span>
                <span className="flex items-baseline gap-3">
                  <span className="text-xs text-white/64">{pluralise(locale, copy.entries, row.entries)}</span>
                  <span className="font-mono tabular-nums text-white">{moneyOf(row.net, row.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- the rows behind them ------------------------------------------ */}

      <section aria-labelledby={`${ids}-payments`} aria-busy={firstPage.status === 'loading'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${ids}-payments`} className="flex items-center gap-3 text-lg font-semibold text-white">
            {copy.listHeading}
            {listReady && <ConsoleCount loaded={rows.length} more={cursor !== null} copy={copy.count} />}
          </h2>
          <Pill variant="ghost" size="sm" disabled={exporting} onClick={() => void download()}>
            {exporting ? copy.exporting : copy.exportCsv}
          </Pill>
        </div>

        {exportNotice !== null && (
          <InlineAlert variant={exportNotice.short ? 'warning' : 'info'} className="mt-4">
            {exportNotice.text}
          </InlineAlert>
        )}
        {exportError !== null && (
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
            {exportError}
          </InlineAlert>
        )}

        {firstPage.status === 'loading' && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <Skeleton height="1rem" width="50%" />
            <Skeleton height="0.875rem" width="30%" className="mt-3" />
          </SkeletonGroup>
        )}

        {listFailed && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {firstPage.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={firstPage.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {listReady && rows.length === 0 && <p className="mt-4 text-sm text-white/64">{copy.listEmpty}</p>}

        {rows.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {rows.map((row) => (
              <PaymentRow key={row.id} payment={row} locale={locale} copy={copy} />
            ))}
          </ul>
        )}

        {listError !== null && (
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
            {listError}
          </InlineAlert>
        )}

        {listReady && cursor !== null && (
          <Pill variant="ghost" size="sm" className="mt-4" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? copy.loading : copy.loadMore}
          </Pill>
        )}
      </section>
    </div>
  );
}

/**
 * One payment or one reversal.
 *
 * <p><strong>A reversal says so in a word</strong>, beside its negative amount. Colour alone
 * must never carry meaning (docs/ui-kit.md §9.2), and a minus sign is exactly the kind of mark
 * that is lost when a row is read aloud or skimmed. It is neutral rather than lime — lime means
 * "act now", and a reversal already recorded asks nothing of anybody.
 *
 * <p>The payer is named and then addressed: the name first, in weight, and the email beside
 * it. A row with only an email read as an address book rather than as a person who paid.
 *
 * <p>A closed account is named as closed rather than left blank. V73 keeps the receipt past
 * the account on purpose, and an empty cell reads as missing data rather than as a person who
 * left.
 */
function PaymentRow({
  payment,
  locale,
  copy,
}: {
  readonly payment: SubscriptionPayment;
  readonly locale: Locale;
  readonly copy: RevenueReportCopy;
}) {
  const backdated = bakuDay(payment.receivedAt) !== bakuDay(payment.recordedAt);
  const name = payment.accountName == null || payment.accountName === '' ? null : payment.accountName;
  const email = payment.accountEmail == null || payment.accountEmail === '' ? null : payment.accountEmail;

  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-2 text-[15px] font-medium text-white">
            <span className="font-mono tabular-nums">{moneyOf(payment.amount, payment.currency)}</span>
            <span>{payment.planName}</span>
            {payment.reversal && (
              <span className="rounded-full border border-white/16 px-2 text-xs font-normal text-white/80">
                {copy.reversal}
              </span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 break-all text-sm text-white/64">
            {name === null && email === null ? (
              <span>{copy.closedAccount}</span>
            ) : (
              <>
                {name !== null && <span className="font-medium text-white">{name}</span>}
                {email !== null && <span>{email}</span>}
              </>
            )}
          </p>
        </div>
        <p className="text-right text-xs text-white/64">
          <span className="block">{copy.method[payment.method]}</span>
          <span className="block">
            {fillPlaceholders(copy.receivedOn, { date: formatExactTime(payment.receivedAt, locale) })}
          </span>
          {backdated && (
            <span className="block">
              {fillPlaceholders(copy.recordedOn, { date: formatExactTime(payment.recordedAt, locale) })}
            </span>
          )}
        </p>
      </div>
      {payment.reference != null && payment.reference !== '' && (
        <p className="mt-2 break-all font-mono text-xs text-white/64">
          {fillPlaceholders(copy.reference, { reference: payment.reference })}
        </p>
      )}
    </li>
  );
}
