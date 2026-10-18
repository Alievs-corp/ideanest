'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import {
  PERIOD_PRESETS,
  isNowFigure,
  readDashboard,
  waitedFor,
  windowFor,
  type Dashboard,
  type DashboardFigure,
  type DashboardPoint,
  type DashboardSectionData,
  type PeriodPreset,
} from '../../lib/admin/dashboard';
import { calendarDate } from '../../lib/admin/console-dates';
import { formatCount, formatPercent } from '../../lib/admin/console-numbers';
import { mayOpenConsoleLink } from '../../lib/admin/navigation';
import { refusalWords } from '../../lib/admin/refusal-words';
import type { StaffCapability } from '../../lib/admin/staff';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { Locale } from '../../lib/i18n/locale';
import { CAMPAIGN_STATES, type ConsoleDashboardCopy } from '../../lib/i18n/admin/dashboard-copy';
import { formatMoney } from '@ideanest/money/format';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { ConsoleColumnChart } from './ConsoleColumnChart';
import { FigureGrid, FigureTile, NoFigure } from './ConsoleFigures';
import { useConsoleMembership } from './ConsoleMembership';
import { useConsoleResource } from './useConsoleResource';

/**
 * The console's front page: how the platform is doing, for the period the reader chooses — #222.
 *
 * <h2>This screen decides nothing about who sees what</h2>
 *
 * <p>The service sends only the sections the reader's roles open, each already gated by the
 * capability its own screen asks for. A moderator's page arrives with the queues and no revenue;
 * there is nothing here to hide and therefore nothing in the browser to unhide. A section this
 * file has no words for is drawn from its key rather than dropped, so a module that publishes a
 * card before its copy exists shows up plainly instead of silently not at all.
 *
 * <h2>A partner never lands here</h2>
 *
 * <p>A partner holds none of the capabilities any section needs, so the service answers them with
 * an empty page, and this one sends them on to their own statistics screen, where the figures are
 * scaled to their share and say so. The real platform figures never reach them through this page.
 *
 * <h2>The period, and now</h2>
 *
 * <p>The period buttons move the money, the campaigns created and the accounts opened. They do not
 * move how many campaigns are running or how many reports are open: those are counts of this
 * moment. Each card draws its period figures first and its present-moment figures under "Now", and
 * the standfirst says which is which — it used to claim every figure followed the period.
 *
 * <h2>One card failing is one card</h2>
 *
 * <p>A section the service could not read arrives as `UNAVAILABLE` and says so in place; the rest
 * of the page is untouched. The whole request failing is a different thing, and is an alert with
 * a retry.
 *
 * <h2>No kit barrel</h2>
 *
 * <p>Like `ConsoleIndex`, which held this route before it, this file imports nothing from
 * `@ideanest/ui`. The barrel lands in one shared chunk and the console shell's own docblock
 * records it costing this route 47.2 KiB the one time it reached for it. The markup here is
 * plain, and the states are words, never colour alone (docs/ui-kit.md §9.2).
 *
 * <h2>Figures are read, not computed</h2>
 *
 * <p>Every value is a decimal string from the service. Money goes through `formatMoney`, counts and
 * the rate through `console-numbers.ts`, in the reader's language. The trend's total is added in whole qəpik by `chart-series.ts`, never
 * in floating point; the column heights are geometry and are never printed.
 *
 * MOTION: none, like every console screen. `docs/motion-system.md` §5.
 */
export interface ConsoleDashboardProps {
  readonly copy: ConsoleDashboardCopy;
}

/** What each card links to, and the capability the destination needs. */
const SECTION_LINKS: Readonly<Record<string, readonly { readonly href: string; readonly label: string }[]>> = {
  figures: [{ href: '/admin/analytics', label: 'analytics' }],
  campaigns: [
    { href: '/admin/moderation/submissions', label: 'moderation' },
    { href: '/admin/campaigns', label: 'campaigns' },
  ],
  reports: [{ href: '/admin/moderation/content', label: 'reports' }],
  support: [{ href: '/admin/support', label: 'support' }],
  accounts: [{ href: '/admin/users', label: 'accounts' }],
};

const LINK_CLASS =
  'rounded-lg text-sm text-white/64 underline underline-offset-2 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]';

export function ConsoleDashboard({ copy }: ConsoleDashboardProps) {
  const [preset, setPreset] = useState<PeriodPreset>('month30');
  const { membership } = useConsoleMembership();
  const capabilities = membership?.capabilities ?? null;
  const locale = useRouteLocale();

  const resource = useConsoleResource(
    (signal) => readDashboard(windowFor(preset), signal),
    copy.subject,
    copy.refusals,
    [preset],
  );

  // Only while the read is current. `useConsoleResource` keeps the last answer across a reload, so
  // a period that is still loading — or failed — would otherwise draw the previous period's
  // figures under the new period's button, with nothing on the page to say they are stale.
  const page = resource.status === 'ready' ? resource.data : null;
  const router = useRouter();
  const isPartner = capabilities?.includes('VIEW_PARTNER_STATISTICS') ?? false;
  const sendToStatistics = page !== null && page.sections.length === 0 && isPartner;

  // A partner's landing is their own statistics page: the service gave them nothing here, and this
  // is where the figures they are entitled to are kept.
  useEffect(() => {
    if (sendToStatistics) router.replace('/admin/partner-statistics');
  }, [sendToStatistics, router]);

  const refusal =
    resource.status === 'forbidden' || resource.status === 'signed-out'
      ? refusalWords(resource.status, resource.capability, copy.subject, copy.refusals)
      : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{copy.title}</h1>
      <p className="mt-2 max-w-[68ch] text-sm text-white/64">{copy.standfirst}</p>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="group" aria-label={copy.periodLegend} className="flex flex-wrap gap-2">
          {PERIOD_PRESETS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={preset === option}
              onClick={() => setPreset(option)}
              className={`inline-flex h-9 items-center rounded-full border px-4 text-sm transition-colors duration-150 ease-in-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)] ${
                preset === option
                  ? 'border-white bg-white text-black'
                  : 'border-white/16 text-white/80 hover:border-white/40 hover:text-white'
              }`}
            >
              {copy.period[option]}
            </button>
          ))}
        </div>
        <Link href="/admin/modules" className={LINK_CLASS}>
          {copy.modulesLink}
        </Link>
      </div>

      {page !== null && (
        <p className="mt-3 text-xs text-white/48">
          {fillPlaceholders(copy.windowNote, {
            from: calendarDate(page.from, locale),
            to: calendarDate(page.to, locale),
          })}
        </p>
      )}

      {resource.status === 'loading' && (
        <div role="status" aria-busy="true" className="mt-8">
          <span className="sr-only">{copy.loading}</span>
          <div className="h-4 w-2/5 rounded bg-surface-2" />
          <div className="mt-3 h-3.5 w-3/5 rounded bg-surface-2" />
        </div>
      )}

      {/* The two refusals in the console's own words: which capability the page wanted, or that the
          session ended. This was the failure alert with the service's sentence in it, which for
          these two is empty. No retry: trying again changes neither. */}
      {refusal !== null && (
        <div role="alert" className="mt-8 rounded-lg border border-white/16 bg-surface-2 p-4">
          <p className="text-sm font-medium text-white">{refusal.title}</p>
          <p className="mt-1 max-w-[68ch] text-sm text-white/64">{refusal.body}</p>
        </div>
      )}

      {resource.status === 'failed' && (
        <div role="alert" className="mt-8 rounded-lg border border-white/16 bg-surface-2 p-4">
          <p className="text-sm font-medium text-white">{copy.errorTitle}</p>
          <p className="mt-1 text-sm text-white/64">{resource.error}</p>
          <button
            type="button"
            onClick={resource.reload}
            className="mt-3 rounded-full border border-white/16 px-4 py-1.5 text-sm text-white/80 hover:border-white/40 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {copy.tryAgain}
          </button>
        </div>
      )}

      {/* Only once the membership is known: before it is, a partner — who is about to be sent to
          their statistics — would see "nothing here for your roles" for a moment first. */}
      {page !== null && page.sections.length === 0 && capabilities !== null && !isPartner && (
        <div className="mt-8 rounded-lg border border-white/8 bg-surface-1 p-5">
          <p className="text-sm font-medium text-white">{copy.emptyTitle}</p>
          <p className="mt-1 max-w-[62ch] text-sm text-white/64">{copy.emptyBody}</p>
        </div>
      )}

      {page !== null && page.sections.length > 0 && (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {page.sections.map((section) => (
            <SectionCard
              key={section.key}
              section={section}
              page={page}
              copy={copy}
              capabilities={capabilities}
              locale={locale}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  section,
  page,
  copy,
  capabilities,
  locale,
}: {
  readonly section: DashboardSectionData;
  readonly page: Dashboard;
  readonly copy: ConsoleDashboardCopy;
  readonly capabilities: readonly StaffCapability[] | null;
  readonly locale: Locale;
}) {
  const headingId = `dash-${section.key}`;
  const links = (SECTION_LINKS[section.key] ?? []).filter((link) => mayOpenConsoleLink(link.href, capabilities));
  const byKey = new Map(section.figures.map((figure) => [figure.key, figure]));

  // The period's figures, then this moment's. The period buttons move the first group and not the
  // second, and the page says which is which rather than claiming every figure follows the period.
  const inPeriod = section.figures.filter((figure) => !isNowFigure(figure.key));
  const now = section.figures.filter((figure) => isNowFigure(figure.key) && !figure.key.startsWith('state.'));
  const states = section.figures.filter((figure) => figure.key.startsWith('state.'));

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5 ${
        section.key === 'figures' ? 'lg:col-span-2' : ''
      }`}
    >
      <h2 id={headingId} className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.section[section.key] ?? section.key}
      </h2>

      {section.status === 'UNAVAILABLE' ? (
        <div role="status" className="mt-3">
          <p className="text-sm font-medium text-white">{copy.unavailableTitle}</p>
          <p className="mt-1 text-sm text-white/64">{copy.unavailableBody}</p>
        </div>
      ) : (
        <>
          {inPeriod.length > 0 && (
            <FigureGrid className="mt-3">
              {inPeriod.map((figure) => (
                <Figure key={figure.key} figure={figure} copy={copy} locale={locale} />
              ))}
            </FigureGrid>
          )}

          {section.series.length > 0 && (
            <Trend
              series={section.series}
              page={page}
              copy={copy}
              currency={byKey.get('pledgeVolume')?.currency ?? 'AZN'}
            />
          )}

          {(now.length > 0 || hasAnyState(states)) && (
            <div className={inPeriod.length > 0 ? 'mt-6' : 'mt-3'}>
              <h3 className="text-sm font-medium text-white">{copy.nowHeading}</h3>
              {now.length > 0 && (
                <FigureGrid className="mt-2">
                  {now.map((figure) => (
                    <Figure key={figure.key} figure={figure} copy={copy} locale={locale} />
                  ))}
                </FigureGrid>
              )}
              <ByState states={states} copy={copy} locale={locale} />
            </div>
          )}
        </>
      )}

      {links.length > 0 && (
        <ul className="mt-4 flex list-none flex-wrap gap-x-4 gap-y-2">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={LINK_CLASS}>
                {copy.link[link.label] ?? link.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One figure as a term and what it is — with how long the longest wait is for a queue, and, for
 * the pledges in another currency, that they are not in the total beside them.
 */
function Figure({
  figure,
  copy,
  locale,
}: {
  readonly figure: DashboardFigure;
  readonly copy: ConsoleDashboardCopy;
  readonly locale: Locale;
}) {
  const waited = figure.since ? waitedFor(figure.since) : null;
  const duration = waited === null ? null : fillPlaceholders(copy[waited.unit], { amount: String(waited.amount) });
  const present = hasValue(figure);

  let note: string | null = null;
  if (duration !== null && present && Number(figure.value) > 0) note = fillPlaceholders(copy.oldest, { duration });
  if (figure.key === 'otherCurrencyPledges' && present && Number(figure.value) > 0) note = copy.otherCurrencyNote;

  return (
    <FigureTile term={copy.figure[figure.key] ?? figure.key} note={note}>
      {present ? display(figure, locale) : <NoFigure>{copy.noSuccessRate}</NoFigure>}
    </FigureTile>
  );
}

/**
 * Whether the service gave a value. It omits a null from the JSON, so an absent field and an
 * explicit `null` both mean "not computable yet", and neither may be drawn as an empty number.
 */
function hasValue(figure: DashboardFigure): boolean {
  return figure.value !== null && figure.value !== undefined && figure.value !== '';
}

/** A figure's value for reading, in the reader's language: money formatted, a rate, a count grouped. */
function display(figure: DashboardFigure, locale: Locale): string {
  const value = figure.value ?? '';
  if (figure.kind === 'MONEY') return formatMoney({ amount: value, currency: figure.currency ?? '' });
  if (figure.kind === 'RATIO') return formatPercent(value, locale);
  return formatCount(value, locale);
}

/**
 * The daily trend: the shared console chart, under its heading.
 *
 * <p>The amounts are in the currency of the pledged total, which is the one the service sums the
 * series in; the chart prints them, the table behind it carries every figure as text.
 */
function Trend({
  series,
  page,
  copy,
  currency,
}: {
  readonly series: readonly DashboardPoint[];
  readonly page: Dashboard;
  readonly copy: ConsoleDashboardCopy;
  readonly currency: string;
}) {
  const locale = useRouteLocale();
  const points = useMemo(
    () => series.map((point) => ({ day: point.date, amount: point.amount, count: point.count })),
    [series],
  );

  return (
    <div className="mt-6">
      <h3 className="text-sm font-medium text-white">{copy.trendHeading}</h3>
      <ConsoleColumnChart
        points={points}
        from={page.from}
        to={page.to}
        currency={currency}
        locale={locale}
        copy={copy.chart}
        height={160}
      />
    </div>
  );
}

function hasAnyState(states: readonly DashboardFigure[]): boolean {
  return states.some((figure) => Number(figure.value ?? 0) > 0);
}

/**
 * Every state that has something in it, in the order a campaign moves through them. Nothing at all
 * when none has, rather than a heading over an empty list.
 */
function ByState({
  states,
  copy,
  locale,
}: {
  readonly states: readonly DashboardFigure[];
  readonly copy: ConsoleDashboardCopy;
  readonly locale: Locale;
}) {
  const counts = new Map(states.map((figure) => [figure.key.slice('state.'.length), figure.value ?? '0']));
  const present = CAMPAIGN_STATES.filter((state) => Number(counts.get(state) ?? 0) > 0);
  if (present.length === 0) return null;

  return (
    <div className="mt-5">
      <h4 className="text-sm text-white/64">{copy.byStateHeading}</h4>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
        {present.map((state) => (
          <div key={state} className="flex items-baseline justify-between gap-2 border-b border-white/6 pb-1">
            <dt className="text-sm text-white/64">{copy.state[state]}</dt>
            <dd className="text-sm tabular-nums text-white">{formatCount(counts.get(state) ?? '0', locale)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
