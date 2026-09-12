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

  const report = useConsoleResource(
    (signal) => readRevenue(request, signal),
    copy.subject,
    copy.refusals,
    [request],
  );
  const firstPage = useConsoleResource(
    (signal) => readSubscriptionPayments(request, {}, signal),
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
  };
  const editTo = (value: string) => {
    touched.current = true;
    setToDay(value);
  };

  const ask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequest({
      from: fromDay === '' ? null : startOfBakuDay(fromDay),
      // Inclusive on screen, exclusive on the wire: the start of the day after the last one.
      to: toDay === '' ? null : startOfBakuDay(shiftDay(toDay, 1)),
      planCode: planCode.trim() === '' ? null : planCode.trim(),
      method: method === '' ? null : method,
    });
  };

  const pickMonth = (offset: number) => {
    const days = monthDays(offset);
    touched.current = true;
    setFromDay(days.from);
    setToDay(days.to);
  };

  /* ---- the list's later pages ------------------------------------------- */

  const [more, setMore] = useState<readonly SubscriptionPayment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // A new first page starts the list again: pages from the previous question are not rows of
  // this one.
  useEffect(() => {
    setMore([]);
    setListError(null);
    setCursor(firstPage.data?.nextCursor ?? null);
  }, [firstPage.data]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null) return;
    const controller = new AbortController();
    setLoadingMore(true);
    setListError(null);
    try {
      const page = await readSubscriptionPayments(request, { after: cursor }, controller.signal);
      setMore((held) => [...held, ...page.payments]);
      setCursor(page.nextCursor ?? null);
    } catch (cause) {
      if (!wasAborted(cause)) setListError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setLoadingMore(false);
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

  const data: RevenueReport | null = report.data;
  const rows = [...(firstPage.data?.payments ?? []), ...more];
  const lastDay = data === null ? null : bakuDay(new Date(Date.parse(data.to) - 1).toISOString());

  return (
    <div className="flex flex-col gap-8">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      {/* ---- the question -------------------------------------------------- */}

      <form onSubmit={ask} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium text-white">{copy.periodLegend}</legend>
          <div className="flex flex-wrap items-end gap-4">
            <Field label={copy.fromLabel} className="min-w-[160px]">
              <TextInput type="date" value={fromDay} onChange={(event) => editFrom(event.target.value)} />
            </Field>
            <Field label={copy.toLabel} hint={copy.toHint} className="min-w-[160px]">
              <TextInput type="date" value={toDay} onChange={(event) => editTo(event.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Pill type="button" variant="ghost" size="sm" onClick={() => pickMonth(0)}>
                {copy.thisMonth}
              </Pill>
              <Pill type="button" variant="ghost" size="sm" onClick={() => pickMonth(-1)}>
                {copy.lastMonth}
              </Pill>
            </div>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-4">
          <Field label={copy.planLabel} hint={copy.planHint} className="min-w-[180px]">
            <TextInput value={planCode} onChange={(event) => setPlanCode(event.target.value)} maxLength={40} />
          </Field>
          <Field label={copy.methodLabel} className="min-w-[200px]">
            <Select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod | '')}>
              <option value="">{copy.anyMethod}</option>
              {PAYMENT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {copy.method[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Pill type="submit" size="sm">
            {copy.show}
          </Pill>
        </div>
      </form>

      {/* ---- the figures --------------------------------------------------- */}

      <section aria-labelledby={`${ids}-totals`}>
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

        {report.status === 'loading' && data === null && (
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
            <Pill variant="ghost" size="sm" className="mt-4" onClick={report.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {data !== null && data.currencies.length === 0 && (
          <EmptyState className="mt-4" variant="empty" title={copy.emptyTitle} description={copy.emptyBody} />
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

      <section aria-labelledby={`${ids}-payments`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${ids}-payments`} className="flex items-center gap-3 text-lg font-semibold text-white">
            {copy.listHeading}
            {firstPage.status === 'ready' && (
              <ConsoleCount loaded={rows.length} more={cursor !== null} copy={copy.count} />
            )}
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

        {firstPage.status === 'loading' && firstPage.data === null && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <Skeleton height="1rem" width="50%" />
            <Skeleton height="0.875rem" width="30%" className="mt-3" />
          </SkeletonGroup>
        )}

        {firstPage.status === 'failed' && (
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
            {firstPage.error}
          </InlineAlert>
        )}

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

        {cursor !== null && (
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
          <p className="mt-1 break-all text-sm text-white/64">
            {payment.accountEmail == null || payment.accountEmail === '' ? (
              <span>{copy.closedAccount}</span>
            ) : (
              <span>{payment.accountEmail}</span>
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
