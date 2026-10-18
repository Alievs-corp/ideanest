import type { AdminTranslator } from '../admin-copy';
import { consoleChartCopyFrom, type ConsoleChartCopy, type ConsoleChromeCopy } from './common-copy';

/**
 * The words on the console's front page — #222.
 *
 * <p>Built from the catalogue by the same function the route calls and the tests call, like every
 * other console screen, so a key that is missing fails a test instead of rendering its own path in
 * a production page.
 */

/** Every campaign state the service can report, for the "by state" list. */
export const CAMPAIGN_STATES = [
  'DRAFT',
  'PRELAUNCH',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'LIVE',
  'CLOSING_WINDOW',
  'EXTENDED',
  'SUSPENDED',
  'CANCELED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'WITHDRAWN',
  'FULFILLING',
  'COMPLETED',
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export interface ConsoleDashboardCopy extends ConsoleChromeCopy {
  readonly title: string;
  readonly subject: string;
  readonly standfirst: string;
  readonly modulesLink: string;
  readonly periodLegend: string;
  readonly period: Readonly<Record<'today' | 'week' | 'month30' | 'thisMonth', string>>;
  /** Carries `{from}` and `{to}`, each already a date in the reader's language. Names Baku's time itself. */
  readonly windowNote: string;
  /** The heading over a card's figures that count this moment rather than the period. */
  readonly nowHeading: string;
  readonly loading: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly unavailableTitle: string;
  readonly unavailableBody: string;
  readonly section: Readonly<Record<string, string>>;
  readonly figure: Readonly<Record<string, string>>;
  readonly noSuccessRate: string;
  readonly otherCurrencyNote: string;
  /** Carries `{duration}`. */
  readonly oldest: string;
  /** Carry `{amount}`. */
  readonly days: string;
  readonly hours: string;
  readonly minutes: string;
  readonly trendHeading: string;
  readonly chart: ConsoleChartCopy;
  readonly byStateHeading: string;
  readonly state: Readonly<Record<CampaignState, string>>;
  readonly link: Readonly<Record<string, string>>;
}

export function consoleDashboardCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): ConsoleDashboardCopy {
  const word = (key: string) => t(`dashboard.${key}`);
  const template = (key: string) => String(t.raw(`dashboard.${key}`));
  const record = (key: string) => t.raw(`dashboard.${key}`) as Readonly<Record<string, string>>;

  return {
    ...chrome,
    title: word('title'),
    subject: word('subject'),
    standfirst: word('standfirst'),
    modulesLink: word('modulesLink'),
    periodLegend: word('periodLegend'),
    period: record('period') as ConsoleDashboardCopy['period'],
    windowNote: template('windowNote'),
    nowHeading: word('nowHeading'),
    loading: word('loading'),
    emptyTitle: word('emptyTitle'),
    emptyBody: word('emptyBody'),
    unavailableTitle: word('unavailableTitle'),
    unavailableBody: word('unavailableBody'),
    section: record('section'),
    figure: record('figure'),
    noSuccessRate: word('noSuccessRate'),
    otherCurrencyNote: word('otherCurrencyNote'),
    oldest: template('oldest'),
    days: template('days'),
    hours: template('hours'),
    minutes: template('minutes'),
    trendHeading: word('trendHeading'),
    chart: consoleChartCopyFrom(t),
    byStateHeading: word('byStateHeading'),
    state: record('state') as ConsoleDashboardCopy['state'],
    link: record('link'),
  };
}
