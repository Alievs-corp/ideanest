'use client';

import { EmptyState, InlineAlert, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import { Link } from '../../i18n/navigation';
import type { ReportedContent } from '../../lib/admin/reported-content';
import type { DirectoryNames } from '../../lib/admin/directory';
import type { ReportedContentCopy } from '../../lib/i18n/admin/content-copy';
import type { ConsoleIdentityCopy } from '../../lib/i18n/admin/common-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatExactTime } from '../../lib/time';
import type { Locale } from '../../lib/i18n/locale';
import { EntityName } from './ConsoleIdentity';

/**
 * What the report is about — issue #399.
 *
 * <h2>The block this page spent its whole life without</h2>
 *
 * `/admin/moderation/{id}` rendered the reason, the reporter's claim, an identifier for the
 * reporter, and two irreversible buttons. Counted in the DOM: zero links in `<main>`. A
 * moderator was asked to uphold or dismiss a complaint about a comment they could not read,
 * written by somebody they could not identify, on a campaign they could not name.
 *
 * <p>What follows from that is not "the screen is thin". It is that the queue cannot be
 * worked honestly: upholding a report you cannot read is the riskier of the two decisions,
 * so the fast safe path is to dismiss everything — and a moderation queue that is always
 * dismissed looks, from every dashboard, exactly like one that is being worked.
 *
 * <h2>Four answers, because the platform can be in four positions</h2>
 *
 * The state is what this branches on, and each branch says something a moderator acts on
 * differently. `REMOVED` is the one that matters most: the text is still shown, because a
 * report filed before the removal still has to be decidable, and the notice above it is what
 * stops the same comment being taken down twice or somebody being banned for a comment a
 * colleague has already handled.
 *
 * <h2>Everything here is untrusted text</h2>
 *
 * The body is what one member of the public wrote about another, arriving on a screen
 * operated by staff. It is rendered as text — never as markup, and never through
 * `dangerouslySetInnerHTML` — for the reason `CampaignStory` gives about a public page and
 * one more: this is the surface where hostile content is expected rather than possible.
 *
 * <h2>Motion</h2>
 *
 * None. The detail page's whole budget is the decision dialog's 200ms entry, and this block
 * is below it.
 */
export interface ReportedContentPanelProps {
  /** What was read, or null while it is still loading. */
  readonly content: ReportedContent | null;
  /** Set when the read failed. The report and its decisions stay on screen regardless. */
  readonly error: string | null;
  readonly names: DirectoryNames;
  readonly locale: Locale;
  readonly copy: ReportedContentCopy;
  readonly identity: ConsoleIdentityCopy;
}

export function ReportedContentPanel({
  content,
  error,
  names,
  locale,
  copy,
  identity,
}: ReportedContentPanelProps) {
  return (
    <section aria-labelledby="report-evidence-heading" className="mt-8">
      <h2
        id="report-evidence-heading"
        className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg"
      >
        {copy.heading}
      </h2>
      <p className="mt-1 max-w-[62ch] text-sm text-fg-48">{copy.intro}</p>

      {/*
        A failure here costs a paragraph, not the page — the same rule the decision history
        follows one section down. A moderator who cannot load the evidence must still be able
        to see what was reported and by whom.
      */}
      {error !== null && (
        <InlineAlert variant="info" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {error === null && content === null && (
        <SkeletonGroup label={copy.loading} className="mt-4">
          <Skeleton height="0.875rem" width="70%" />
          <Skeleton height="0.875rem" width="55%" className="mt-2" />
        </SkeletonGroup>
      )}

      {content !== null && content.state === 'GONE' && (
        <EmptyState
          className="mt-4"
          variant="empty"
          title={copy.goneTitle}
          description={copy.goneBody}
        />
      )}

      {content !== null && content.state === 'ADDRESSED_DIRECTLY' && (
        <div className="mt-4 rounded-xl border border-fg/8 bg-surface-1 p-4 sm:p-5">
          <p className="max-w-[62ch] text-sm text-fg-64">{copy.addressedBody}</p>
          {content.project != null && (
            <p className="mt-3">
              <CampaignLink id={content.project.id} title={content.project.title} label={copy.openCampaign} />
            </p>
          )}
        </div>
      )}

      {content !== null && (content.state === 'PRESENT' || content.state === 'REMOVED') && (
        <div className="mt-4 rounded-xl border border-fg/8 bg-surface-1 p-4 sm:p-5">
          {content.state === 'REMOVED' && (
            /*
              Amber and a word, never a colour alone — docs/ui-kit.md §9.2. This is the one
              fact on the block a moderator must not miss: somebody has already acted.
            */
            <InlineAlert variant="warning" title={copy.removedTitle} className="mb-4">
              {copy.removedBody}
            </InlineAlert>
          )}

          {(content.title != null || content.number != null) && (
            <p className="flex flex-wrap items-baseline gap-x-2">
              {content.number != null && (
                <Tag variant="default">
                  {fillPlaceholders(copy.updateNumber, { number: String(content.number) })}
                </Tag>
              )}
              {content.title != null && (
                <span className="text-sm sm:text-[15px] font-medium text-fg">{content.title}</span>
              )}
            </p>
          )}

          {/* Untrusted: what one person wrote about another, rendered only ever as text. */}
          {content.body != null && content.body !== '' ? (
            <blockquote className="mt-3 rounded-md border-l-2 border-fg/16 bg-surface-3 py-3 pl-4 pr-3 text-sm whitespace-pre-line text-fg-80">
              {content.body}
            </blockquote>
          ) : (
            <p className="mt-3 text-sm text-fg-40">{copy.noText}</p>
          )}

          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {content.authorId != null && (
              <div className="flex gap-2">
                <dt className="text-fg-40">{copy.authorLabel}</dt>
                <dd className="text-fg-64">
                  <EntityName id={content.authorId} names={names} kind="account" copy={identity} copyable />
                </dd>
              </div>
            )}
            {content.project != null && (
              <div className="flex gap-2">
                <dt className="text-fg-40">{copy.campaignLabel}</dt>
                <dd className="text-fg-64">
                  <CampaignLink id={content.project.id} title={content.project.title} label={copy.openCampaign} />
                </dd>
              </div>
            )}
            {content.createdAt != null && (
              <div className="flex gap-2">
                <dt className="text-fg-40">{copy.writtenLabel}</dt>
                <dd className="text-fg-64">
                  <time dateTime={content.createdAt}>{formatExactTime(content.createdAt, locale)}</time>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

/**
 * The campaign, linked to the staff preview rather than to its public page.
 *
 * <p>Deliberately the preview and not `/projects/{creatorSlug}/{slug}`, even though the
 * response carries both halves of that path. A comment can be reported on a campaign that is
 * later suspended, and a suspended campaign has no public page — so the obvious link is the
 * one that answers 404 exactly when a moderator most needs it, which is the defect #399 was
 * filed about.
 *
 * <p>A new tab, so the report and any decision half-taken on it survive the trip.
 */
function CampaignLink({
  id,
  title,
  label,
}: {
  readonly id: string;
  readonly title: string;
  readonly label: string;
}) {
  return (
    <Link
      href={`/admin/campaigns/${encodeURIComponent(id)}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`${label}: ${title}`}
      className="rounded-lg underline underline-offset-4 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
    >
      {title}
    </Link>
  );
}
