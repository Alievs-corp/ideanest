'use client';

import {
  EmptyState,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@ideanest/ui';
import {
  readPartnerStatistics,
  type CurrencyFigures,
  type PartnerStatistics,
} from '../../lib/admin/partnerStatistics';
import { capitalised, dateTimeFormat, numberFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate } from '../../lib/time';
import type { PartnerStatisticsCopy } from '../../lib/i18n/admin/partner-copy';
import { formatMoney } from '../../lib/money';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * The financial statistics, for a partner and for a super admin — #206, part of #202.
 *
 * <h2>This screen computes nothing</h2>
 *
 * <p>Every number arrives already scaled, or not, by the service: a partner's figures are the
 * real ones multiplied by their percentage there, and a super admin's are the real ones. This
 * component formats what it is given. It has no percentage to apply and no figure to divide, so
 * there is nothing here for a browser's developer tools to change into a larger number — and the
 * service would not send one, because which answer a caller gets is decided on its side from
 * their roles and never from the request.
 *
 * <h2>One line, in the header, and never repeated</h2>
 *
 * <p>A partner sees that these are their share of the platform's figures, once, at the top:
 * "Partner's share: 50% of the platform's figures." The line comes from the response's `view`,
 * not from a flag this component decides, so a screen showing a partner's figures cannot be
 * rendered without it. A super admin is told the opposite, that these are the real ones, so
 * nobody reads a scaled number as a whole or a whole as a share.
 *
 * <h2>Aggregates only, because that is all there is</h2>
 *
 * <p>No transaction, payer, reference or amount of one payment exists in the response, so none
 * can be drawn. A day is a row, a month is a row, a plan is a row.
 *
 * MOTION: none, like every console screen. `docs/motion-system.md` §5.
 */
export interface PartnerStatisticsViewProps {
  readonly copy: PartnerStatisticsCopy;
}

export function PartnerStatisticsView({ copy }: PartnerStatisticsViewProps) {
  const locale = useRouteLocale();
  const resource = useConsoleResource(
    (signal) => readPartnerStatistics(signal),
    copy.subject,
    copy.refusals,
    [],
  );

  if (resource.status === 'signed-out' || resource.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={resource.status}
        capability={resource.capability}
        subject={copy.subject}
        copy={copy.refusals}
      />
    );
  }

  if (resource.status === 'loading') {
    return (
      <SkeletonGroup label={copy.loadingStatistics}>
        <Skeleton height="1rem" width="40%" />
        <Skeleton height="0.875rem" width="60%" className="mt-3" />
      </SkeletonGroup>
    );
  }

  if (resource.status === 'failed') {
    return (
      <>
        <InlineAlert variant="danger" title={copy.errorTitle}>
          {resource.error}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={resource.reload}>
          {copy.tryAgain}
        </Pill>
      </>
    );
  }

  if (resource.data?.kind === 'not-configured') {
    return (
      <InlineAlert variant="info" title={copy.notConfiguredTitle}>
        {copy.notConfiguredBody}
      </InlineAlert>
    );
  }

  const statistics = resource.data?.kind === 'ready' ? resource.data.statistics : null;
  if (statistics === null) return null;

  return <Statistics statistics={statistics} copy={copy} locale={locale} />;
}

/** How the three columns of every figure are written, for this reader and this view. */
interface Formatting {
  readonly locale: Locale;
  readonly view: PartnerStatistics['view'];
}

function Statistics({
  statistics,
  copy,
  locale,
}: {
  readonly statistics: PartnerStatistics;
  readonly copy: PartnerStatisticsCopy;
  readonly locale: Locale;
}) {
  const formatting: Formatting = { locale, view: statistics.view };
  const currencies = currenciesIn(statistics);

  return (
    <div className="flex flex-col gap-10">
      <div>
        {/*
          Which view this is, from the response. For a partner: their share, said once. For a
          super admin: that these are the real figures. Neither is repeated on any number.
        */}
        <p className="rounded-lg border border-white/8 bg-surface-2 px-4 py-3 text-sm text-white">
          {statistics.view === 'PARTNER'
            ? fillPlaceholders(copy.partnerLine, { percentage: trimPercent(statistics.sharePercentage) })
            : copy.realLine}
        </p>
        {/* "Baku time", not "Asia/Baku": the identifier is for a computer. */}
        <p className="mt-2 text-xs text-white/48">
          {statistics.timeZone === BAKU
            ? copy.zoneNoteBaku
            : fillPlaceholders(copy.zoneNote, { zone: statistics.timeZone })}
        </p>
      </div>

      <section aria-labelledby="stats-today-heading">
        <h2 id="stats-today-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.todayHeading}
        </h2>
        <p className="mt-1 text-xs text-white/48">{dayLabel(statistics.today.date, locale)}</p>
        <Figures figures={statistics.today.currencies} formatting={formatting} copy={copy} />
      </section>

      <section aria-labelledby="stats-month-heading">
        <h2 id="stats-month-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.monthHeading}
        </h2>
        <p className="mt-1 text-xs text-white/48">{monthLabel(statistics.thisMonth.month, locale)}</p>
        <Figures figures={statistics.thisMonth.currencies} formatting={formatting} copy={copy} />
      </section>

      <section aria-labelledby="stats-daily-heading">
        <h2 id="stats-daily-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.dailyHeading}
        </h2>
        <FiguresTable
          caption={copy.dailyCaption}
          firstColumn={copy.dateColumn}
          formatting={formatting}
          copy={copy}
          rows={statistics.daily.flatMap((day) =>
            day.currencies.map((figures) => ({
              key: `${day.date}-${figures.currency}`,
              label: dayLabel(day.date, locale),
              figures,
            })),
          )}
        />
      </section>

      <section aria-labelledby="stats-monthly-heading">
        <h2 id="stats-monthly-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.monthlyHeading}
        </h2>
        {/*
          Twelve months means twelve rows. The service sends a month nobody paid in as an empty
          list, and it used to vanish from the table, so "the last twelve months" showed seven
          and a quiet month read as a gap in the data. It is a row of zeroes in every currency
          the rest of the year was paid in.
        */}
        <FiguresTable
          caption={copy.monthlyCaption}
          firstColumn={copy.monthColumn}
          formatting={formatting}
          copy={copy}
          rows={statistics.monthly.flatMap((month) =>
            (month.currencies.length > 0 ? month.currencies : currencies.map(nothingIn)).map((figures) => ({
              key: `${month.month}-${figures.currency}`,
              label: monthLabel(month.month, locale),
              figures,
            })),
          )}
        />
      </section>

      <section aria-labelledby="stats-plans-heading">
        <h2 id="stats-plans-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.planHeading}
        </h2>
        <FiguresTable
          caption={copy.planCaption}
          firstColumn={copy.planColumn}
          formatting={formatting}
          copy={copy}
          rows={statistics.byPlan.map((plan) => ({
            key: `${plan.planCode}-${plan.planName}-${plan.currency}`,
            label: plan.planName,
            figures: {
              currency: plan.currency,
              revenue: plan.revenue,
              subscriptions: plan.subscriptions,
              reversals: plan.reversals,
            },
          }))}
        />
      </section>
    </div>
  );
}

/** One period's figures, per currency, as a description list: a term and what it is. */
function Figures({
  figures,
  formatting,
  copy,
}: {
  readonly figures: readonly CurrencyFigures[];
  readonly formatting: Formatting;
  readonly copy: PartnerStatisticsCopy;
}) {
  if (figures.length === 0) {
    return <p className="mt-3 text-sm text-white/64">{copy.nothingRecorded}</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-4">
      {figures.map((row) => (
        <dl key={row.currency} className="grid max-w-[560px] grid-cols-3 gap-4">
          <div>
            <dt className="text-xs text-white/48">{copy.revenue}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-white">
              {formatMoney({ amount: row.revenue, currency: row.currency })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-white/48">{copy.subscriptions}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-white">
              {formatCount(row.subscriptions, formatting)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-white/48">{copy.reversals}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-white">
              {formatCount(row.reversals, formatting)}
            </dd>
          </div>
        </dl>
      ))}
    </div>
  );
}

interface FiguresRow {
  readonly key: string;
  readonly label: string;
  readonly figures: CurrencyFigures;
}

/** Rows of the same three figures under a caption that names what they are. */
function FiguresTable({
  caption,
  firstColumn,
  rows,
  formatting,
  copy,
}: {
  readonly caption: string;
  readonly firstColumn: string;
  readonly rows: readonly FiguresRow[];
  readonly formatting: Formatting;
  readonly copy: PartnerStatisticsCopy;
}) {
  if (rows.length === 0) {
    return <EmptyState className="mt-4" variant="empty" title={copy.nothingRecorded} description="" />;
  }

  return (
    <Table caption={caption} className="mt-4">
      <TableHead>
        <TableRow interactive={false}>
          <TableHeaderCell>{firstColumn}</TableHeaderCell>
          <TableHeaderCell align="right">{copy.revenue}</TableHeaderCell>
          <TableHeaderCell align="right">{copy.subscriptions}</TableHeaderCell>
          <TableHeaderCell align="right">{copy.reversals}</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>{row.label}</TableCell>
            <TableCell align="right">
              {formatMoney({ amount: row.figures.revenue, currency: row.figures.currency })}
            </TableCell>
            <TableCell align="right">{formatCount(row.figures.subscriptions, formatting)}</TableCell>
            <TableCell align="right">{formatCount(row.figures.reversals, formatting)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const BAKU = 'Asia/Baku';

/**
 * Every currency the response mentions, in the order first seen — the currencies an empty month
 * is drawn as zero in. Empty when nothing was paid all year, and then the table says so.
 */
function currenciesIn(statistics: PartnerStatistics): string[] {
  const seen = new Set<string>();
  for (const month of statistics.monthly) for (const row of month.currencies) seen.add(row.currency);
  for (const row of statistics.thisMonth.currencies) seen.add(row.currency);
  return [...seen];
}

function nothingIn(currency: string): CurrencyFigures {
  return { currency, revenue: '0.00', subscriptions: '0.00', reversals: '0.00' };
}

/**
 * A `YYYY-MM-DD` Baku day in the reader's words. Formatted at noon UTC, which is the same
 * calendar day in every zone from UTC−11 to UTC+11.
 */
function dayLabel(day: string, locale: Locale): string {
  return formatDate(`${day}T12:00:00Z`, locale);
}

/** A `YYYY-MM` Baku month as its name and year: "Oktyabr 2026", not "2026-10". */
function monthLabel(month: string, locale: Locale): string {
  const at = new Date(`${month}-15T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return month;
  const written = dateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }, 'stats-month').format(at);
  return capitalised(written, locale);
}

/**
 * A count, which the service sends as a two-place decimal string.
 *
 * <p>The real view's counts are whole — "14.00" is fourteen subscriptions — so they are drawn
 * as whole numbers. A partner's are scaled by their share and can be fractional ("3.50"), so
 * they keep both places, with the reader's decimal separator. Parsed only to be formatted: the
 * value has two places and a double holds that exactly enough to print it back.
 */
function formatCount(value: string, { locale, view }: Formatting): string {
  const whole = /^-?\d+(\.0+)?$/.test(value);
  const number = Number(value);
  if (Number.isNaN(number)) return value;
  if (view === 'REAL' && whole) {
    return numberFormat(locale, { maximumFractionDigits: 0 }, 'stats-count-whole').format(number);
  }
  return numberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, 'stats-count-share').format(number);
}

/** `"50.00"` reads as `50`; `"33.33"` stays. A percentage is not money and two trailing zeros are noise. */
function trimPercent(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}
