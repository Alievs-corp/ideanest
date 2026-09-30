'use client';

import { useEffect, useState } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import {
  PERIOD_PRESETS,
  readDashboard,
  waitedFor,
  windowFor,
  type Dashboard,
  type DashboardFigure,
  type DashboardPoint,
  type DashboardSectionData,
  type PeriodPreset,
} from '../../lib/admin/dashboard';
import { mayOpenConsoleLink } from '../../lib/admin/navigation';
import type { StaffCapability } from '../../lib/admin/staff';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { CAMPAIGN_STATES, type ConsoleDashboardCopy } from '../../lib/i18n/admin/dashboard-copy';
import { formatMoney } from '@ideanest/money/format';
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
 * <p>Every value is a decimal string from the service. Money goes through `formatMoney`, counts
 * are grouped for reading, and the only arithmetic is the bar heights of the trend, which are
 * geometry and are never printed.
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

export function ConsoleDashboard({ copy }: ConsoleDashboardProps) {
  const [preset, setPreset] = useState<PeriodPreset>('month30');
  const { membership } = useConsoleMembership();
  const capabilities = membership?.capabilities ?? null;

  const resource = useConsoleResource(
    (signal) => readDashboard(windowFor(preset), signal),
    copy.subject,
    copy.refusals,
    [preset],
  );

  const page = resource.data;
  const router = useRouter();
  const sendToStatistics =
    page !== null && page.sections.length === 0 && (capabilities?.includes('VIEW_PARTNER_STATISTICS') ?? false);

  // A partner's landing is their own statistics page: the service gave them nothing here, and this
  // is where the figures they are entitled to are kept.
  useEffect(() => {
    if (sendToStatistics) router.replace('/admin/partner-statistics');
  }, [sendToStatistics, router]);

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
        <Link
          href="/admin/modules"
          className="rounded-lg text-sm text-white/64 underline underline-offset-2 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          {copy.modulesLink}
        </Link>
      </div>

      {page !== null && (
        <p className="mt-3 text-xs text-white/48">
          {fillPlaceholders(copy.windowNote, { from: page.from, to: page.to, zone: page.timeZone })}
        </p>
      )}

      {resource.status === 'loading' && (
        <div role="status" aria-busy="true" className="mt-8">
          <span className="sr-only">{copy.loading}</span>
          <div className="h-4 w-2/5 rounded bg-surface-2" />
          <div className="mt-3 h-3.5 w-3/5 rounded bg-surface-2" />
        </div>
      )}

      {(resource.status === 'failed' || resource.status === 'forbidden' || resource.status === 'signed-out') && (
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

      {page !== null && page.sections.length === 0 && !sendToStatistics && (
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
}: {
  readonly section: DashboardSectionData;
  readonly page: Dashboard;
  readonly copy: ConsoleDashboardCopy;
  readonly capabilities: readonly StaffCapability[] | null;
}) {
  const headingId = `dash-${section.key}`;
  const links = (SECTION_LINKS[section.key] ?? []).filter((link) => mayOpenConsoleLink(link.href, capabilities));
  const byKey = new Map(section.figures.map((figure) => [figure.key, figure]));

  const plain = section.figures.filter((figure) => !figure.key.startsWith('state.'));
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
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
            {plain.map((figure) => (
              <FigureTile key={figure.key} figure={figure} copy={copy} />
            ))}
          </dl>

          {section.key === 'figures' && byKey.has('otherCurrencyPledges') && Number(byKey.get('otherCurrencyPledges')?.value ?? 0) > 0 && (
            <p className="mt-3 text-xs text-white/48">{copy.otherCurrencyNote}</p>
          )}

          {section.series.length > 0 && (
            <Trend
              series={section.series}
              page={page}
              copy={copy}
              currency={byKey.get('pledgeVolume')?.currency ?? 'AZN'}
            />
          )}

          {states.length > 0 && <ByState states={states} copy={copy} />}
        </>
      )}

      {links.length > 0 && (
        <ul className="mt-4 flex list-none flex-wrap gap-x-4 gap-y-2">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-lg text-sm text-white/64 underline underline-offset-2 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
              >
                {copy.link[link.label] ?? link.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One figure as a term and what it is, with how long the longest wait is for a queue. */
function FigureTile({ figure, copy }: { readonly figure: DashboardFigure; readonly copy: ConsoleDashboardCopy }) {
  const waited = figure.since ? waitedFor(figure.since) : null;
  const duration = waited === null ? null : fillPlaceholders(copy[waited.unit], { amount: String(waited.amount) });

  return (
    <div>
      <dt className="text-xs text-white/48">{copy.figure[figure.key] ?? figure.key}</dt>
      {/* The wait sits inside the description, not beside it: a description list's groups may hold
          only terms and descriptions, and a paragraph between them fails the rule and confuses a
          screen reader about which term the age belongs to. */}
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-white">
        {hasValue(figure) ? display(figure) : <span className="text-base font-normal text-white/48">{copy.noSuccessRate}</span>}
        {duration !== null && hasValue(figure) && Number(figure.value) > 0 && (
          <span className="mt-1 block text-xs font-normal text-white/48">
            {fillPlaceholders(copy.oldest, { duration })}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Whether the service gave a value. It omits a null from the JSON, so an absent field and an
 * explicit `null` both mean "not computable yet", and neither may be drawn as an empty number.
 */
function hasValue(figure: DashboardFigure): boolean {
  return figure.value !== null && figure.value !== undefined && figure.value !== '';
}

/** A figure's value for reading: money formatted, a ratio with its sign, a count grouped. */
function display(figure: DashboardFigure): string {
  const value = figure.value ?? '';
  if (figure.kind === 'MONEY') return formatMoney({ amount: value, currency: figure.currency ?? '' });
  if (figure.kind === 'RATIO') return `${value}%`;
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The daily trend, as bars with the table as its alternative.
 *
 * <p>The bars are drawn from the amounts as geometry only and carry their meaning in an
 * `aria-label` that says the period and the highest day, so a reader who cannot see them loses
 * nothing; the full figures are one disclosure away as a real table. The height of a bar is never
 * printed, so nothing here is arithmetic on money that somebody could read as a figure.
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
  /** The currency of the pledged total, which is the one the daily amounts are in. */
  readonly currency: string;
}) {
  const heights = series.map((point) => Number(point.amount));
  const peak = Math.max(...heights, 0);
  const highest = series.reduce((best, point) => (Number(point.amount) > Number(best.amount) ? point : best), series[0] as DashboardPoint);
  const slot = 100 / series.length;

  return (
    <div className="mt-5">
      <h3 className="text-sm font-medium text-white">{copy.trendHeading}</h3>
      <svg
        role="img"
        aria-label={fillPlaceholders(copy.trendSummary, {
          from: page.from,
          to: page.to,
          highest: `${highest.date} ${formatMoney({ amount: highest.amount, currency })}`,
        })}
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="mt-2 h-24 w-full text-white/40"
      >
        {series.map((point, index) => {
          const height = peak === 0 ? 0.5 : Math.max(0.5, (Number(point.amount) / peak) * 30);
          return (
            <rect
              key={point.date}
              x={index * slot + slot * 0.15}
              y={32 - height}
              width={slot * 0.7}
              height={height}
              fill="currentColor"
            />
          );
        })}
      </svg>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-white/64 hover:text-white">{copy.trendTableToggle}</summary>
        <div className="mt-2 max-h-72 overflow-auto" role="region" aria-label={copy.trendHeading} tabIndex={0}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{copy.trendHeading}</caption>
            <thead>
              <tr className="text-xs text-white/48">
                <th scope="col" className="py-2 pr-4 font-normal">{copy.dateColumn}</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">{copy.pledgedColumn}</th>
                <th scope="col" className="py-2 text-right font-normal">{copy.pledgesColumn}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.date} className="border-t border-white/6">
                  <td className="py-2 pr-4 text-white">{point.date}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-white">
                    {formatMoney({ amount: point.amount, currency })}
                  </td>
                  <td className="py-2 text-right tabular-nums text-white">{point.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Every state that has something in it, in the order a campaign moves through them. */
function ByState({
  states,
  copy,
}: {
  readonly states: readonly DashboardFigure[];
  readonly copy: ConsoleDashboardCopy;
}) {
  const counts = new Map(states.map((figure) => [figure.key.slice('state.'.length), figure.value ?? '0']));
  const present = CAMPAIGN_STATES.filter((state) => Number(counts.get(state) ?? 0) > 0);

  return (
    <div className="mt-5">
      <h3 className="text-sm font-medium text-white">{copy.byStateHeading}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {present.map((state) => (
          <div key={state} className="flex items-baseline justify-between gap-2 border-b border-white/6 pb-1">
            <dt className="text-sm text-white/64">{copy.state[state]}</dt>
            <dd className="text-sm tabular-nums text-white">{counts.get(state)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
