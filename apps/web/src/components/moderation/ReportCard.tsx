'use client';

import { Link } from '../../i18n/navigation';
import { Card, Pill, Tag } from '@ideanest/ui';
import type { QueuedReport } from '../../lib/moderation/api';
import {
  formatExactTime,
  formatRelativeTime,
  isOverdue,
  isRepeated,
  openReportsLabel,
  shortId,
} from '../../lib/moderation/describe';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import type { ModerationQueueCopy } from '../../lib/i18n/admin/content-copy';
import type { ReportDecision } from './DecisionDialog';
import type { Locale } from '../../lib/i18n/locale';
import type { DirectoryNames } from '../../lib/admin/directory';
import { EntityName } from '../admin/ConsoleIdentity';

export interface ReportCardProps {
  readonly report: QueuedReport;
  /**
   * What the console directory resolved for the identifiers on this card — issue #402.
   *
   * <p>Passed down rather than looked up here: twenty cards each asking about their own
   * target is twenty requests for one screen, and the queue already holds every identifier
   * before the first card renders.
   */
  readonly names: DirectoryNames;
  /** Pinned per load, so every card on one render ages from the same instant. */
  readonly now: Date;
  /** Fixed by the caller for the same reason `now` is — #324. */
  readonly locale: Locale;
  readonly busy: boolean;
  /**
   * The decision detail view for this report (#296), or absent where there is none.
   *
   * <p>A card carries everything needed to decide a report and deliberately not everything
   * known about one: the full decision history, and the other complaints about the same
   * target, belong on a page rather than on a row in a queue somebody is skimming.
   */
  readonly detailHref?: string;
  readonly onDecide: (report: QueuedReport, decision: ReportDecision) => void;
  readonly copy: ModerationQueueCopy;
}

const REPORT_OUTCOMES = ['uphold', 'dismiss'] as const;

/**
 * The state word, with a token that means what the word means.
 *
 * `UPHELD` is `--success` and never lime: the complaint was answered, and lime
 * says "act now" (docs/ui-kit.md §2.4). `DISMISSED` is neutral — a dismissal is
 * not a failure and colouring it `--danger` would read as one. The word is
 * always present, so colour is never the carrier (§9.2).
 */
function stateVariant(report: QueuedReport): 'success' | 'default' {
  return report.state === 'UPHELD' ? 'success' : 'default';
}

/**
 * One complaint, everything a moderator needs to decide it, and the five things
 * they can do about it.
 *
 * NO ENTRY ANIMATION. docs/motion-system.md §5 puts a working tool at "minimal"
 * or "none", §8 rules out animation in long lists outright, and this is both. A
 * card fading in under somebody triaging abuse reports is 300ms in which the
 * button cannot be aimed at. Hover is the standard 150ms colour change `Card`
 * already carries and nothing else moves.
 */
export function ReportCard({
  report,
  now,
  locale,
  names,
  busy,
  detailHref,
  onDecide,
  copy,
}: ReportCardProps) {
  const kind = copy.moderation.target[report.target.type];
  const target = fillPlaceholders(copy.moderation.targetName, {
    kind,
    id: shortId(report.target.id),
  });
  const overdue = isOverdue(report, now);
  const open = report.state === 'OPEN';
  const headingId = `report-${report.id}-heading`;

  return (
    <li>
      <Card
        aria-labelledby={headingId}
        className={busy ? 'opacity-60' : undefined}
        aria-busy={busy || undefined}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              id={headingId}
              className="text-lg font-medium tracking-[-0.02em] text-fg"
            >
              {copy.moderation.reason[report.reason]}
            </h3>
            <p className="mt-1 text-sm text-fg-64">
              {/*
                `fillNodes` rather than two half-sentences: the identifier is styled, and
                splitting the sentence around it would fix the word order in English —
                which is the one thing a translation is entitled to change.
              */}
              {fillNodes(copy.reportedAbout, {
                kind,
                /*
                  #402: a card read "complaint about account c8edac99", which is a decision
                  about somebody the screen could not name. A comment or an update has no
                  name to look up and keeps its fragment — that gap is #399's.
                */
                id:
                  report.target.type === 'USER' || report.target.type === 'PROJECT' ? (
                    <EntityName
                      id={report.target.id}
                      names={names}
                      kind={report.target.type === 'USER' ? 'account' : 'project'}
                      copy={copy.identity}
                    />
                  ) : (
                    <span className="font-mono text-fg-64">{shortId(report.target.id)}</span>
                  ),
              })}
            </p>
            {/*
              The name says which report, for the reason the decision buttons below give:
              twenty cards offering "Open" is unusable by ear, and this one leads to a
              screen about somebody's account.
            */}
            {detailHref !== undefined && (
              <Link
                href={detailHref}
                aria-label={fillPlaceholders(copy.fullHistoryLabel, { target })}
                className="mt-2 inline-block rounded-lg text-sm text-fg-64 underline underline-offset-2 transition-colors duration-150 ease-in-out hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                {copy.fullHistory}
              </Link>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              Lime is a SURFACE with near-black text on it, and it is the one
              lime element on the card — docs/ui-kit.md §8.2's rule for a
              filtered feed, which this is: the queue is sorted oldest first and
              a backlog would otherwise turn every card lime and say nothing.
              The word carries the meaning; the colour only makes it findable.
            */}
            {overdue && (
              <span
                data-on-lime
                className="inline-flex h-[26px] items-center rounded-sm bg-lime-500 px-2.5 text-xs font-medium text-on-lime"
              >
                {copy.overdue}
              </span>
            )}
            {isRepeated(report) && (
              <Tag variant="warning">
                {pluralise(locale, copy.moderation.reportCount, report.openReportsOnTarget)}
              </Tag>
            )}
            <Tag variant={stateVariant(report)}>{copy.moderation.state[report.state]}</Tag>
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-fg-40">{copy.reported}</dt>
            <dd className="text-fg-64">
              <time dateTime={report.createdAt} title={formatExactTime(report.createdAt, locale)}>
                {formatRelativeTime(report.createdAt, now, locale)}
              </time>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-40">{copy.signal}</dt>
            <dd className="text-fg-64">
              {openReportsLabel(report, copy.moderation, locale)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-40">{copy.reporter}</dt>
            {/*
              Named since #402, with the identifier still beside it. A report is an
              accusation, and "this account has reported forty campaigns this week" is the
              question that catches abuse of the feature — asked by identifier, answered by
              a person, so the row needs both.
            */}
            <dd className="text-fg-64">
              <EntityName
                id={report.reporterId}
                names={names}
                kind="account"
                copy={copy.identity}
              />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-40">{copy.targetTerm}</dt>
            <dd className="font-mono text-fg-64">{report.target.id}</dd>
          </div>
        </dl>

        {report.detail != null && report.detail !== '' && (
          <blockquote className="mt-4 rounded-md border-l-2 border-fg/16 bg-surface-3 py-3 pl-4 pr-3 text-sm text-fg-64">
            {report.detail}
          </blockquote>
        )}

        {/*
          HISTORY. Read back from the audited record the service returns, not
          reconstructed from what this screen happens to have done — a queue that
          remembers only its own session cannot answer who decided something last
          March.
        */}
        {report.resolution != null && (
          <div className="mt-4 rounded-md bg-surface-3 p-4">
            <h4 className="text-sm font-medium text-fg">{copy.moderation.decisionHeading}</h4>
            <p className="mt-1 text-sm text-fg-64">
              {fillNodes(copy.moderation.decidedBy[report.state], {
                moderator: (
                  <EntityName
                    id={report.resolution.moderatorId}
                    names={names}
                    kind="account"
                    copy={copy.identity}
                  />
                ),
                at: (
                  <time dateTime={report.resolution.at}>
                    {formatExactTime(report.resolution.at, locale)}
                  </time>
                ),
              })}
            </p>
            {report.resolution.note != null && report.resolution.note !== '' ? (
              <p className="mt-2 text-sm text-fg-64">{report.resolution.note}</p>
            ) : (
              <p className="mt-2 text-sm text-fg-40">{copy.moderation.noNote}</p>
            )}
          </div>
        )}

        {open && (
          <div className="mt-5">
            <div role="group" aria-label={fillPlaceholders(copy.decideGroup, { target })}>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-40">
                {copy.decideHeading}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {REPORT_OUTCOMES.map((outcome) => (
                  <Pill
                    key={outcome}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    /*
                      The visible word is inside the accessible name, so speech
                      input can still reach the control by what is printed on it
                      (WCAG 2.5.3), and the name says which report it acts on —
                      twenty cards of "Uphold" is unusable by ear and dangerous
                      here, where every button is irreversible.
                    */
                    aria-label={fillPlaceholders(copy.decideLabel, {
                      outcome: copy.moderation.reportOutcome[outcome],
                      target,
                    })}
                    onClick={() => onDecide(report, { kind: 'report', outcome })}
                  >
                    {copy.moderation.reportOutcome[outcome]}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}
