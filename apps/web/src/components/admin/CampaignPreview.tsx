'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { Link, localeHref } from '../../i18n/navigation';
import { ApiError } from '../../lib/api/problem';
import { readCampaignPreview } from '../../lib/admin/campaigns';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import { RENDERABLE_STATES, type CampaignPage } from '../../lib/projects/publicPage';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatDate } from '../../lib/time';
import { formatMoney } from '../../lib/money';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { CampaignPreviewCopy } from '../../lib/i18n/admin/content-copy';
import { CampaignStory } from '../project/CampaignStory';
import { ConsoleRefusal } from './ConsoleRefusal';
import { CopyIdentifier } from './ConsoleIdentity';

/**
 * A campaign as its page reads, for the moderator deciding it — issue #399.
 *
 * <h2>The screen the submission queue was asking for a decision without</h2>
 *
 * `/admin/moderation/submissions` lists campaigns awaiting review with Approve, Request
 * changes and Reject, and the campaign's title was the one link on each card. It pointed at
 * the public page. A campaign in review is not public — that is what being in review means —
 * so the link answered 404 by construction, and the decision was taken on a title, a
 * creator's name and a goal figure. The two thousand words the creator actually wrote were
 * one screen away and reachable by nobody.
 *
 * <h2>The same page a backer would see, and that is the requirement</h2>
 *
 * The service serves this from `PublicProjectPages` — the identical projection the public
 * campaign page is served from — and the story is rendered by {@link CampaignStory}, the
 * identical component. A moderator decides whether a campaign may be published, so what
 * they are shown has to be what publishing it would show. A purpose-built summary would be
 * a second description of the campaign, and the decision would be taken against the summary.
 *
 * <h2>It says what it is, at the top, before anything else</h2>
 *
 * This renders drafts. A draft is a private working document its creator has shown nobody,
 * and a member of staff who has forgotten which screen they are on is one screenshot away
 * from a problem. The notice is not decoration and it is not dismissible.
 *
 * <h2>Nothing here changes anything</h2>
 *
 * No approve, no reject, no suspend. The three moderation outcomes live on the queue where
 * the campaign's own state and the waiting time are in view, and suspension is its own
 * screen with its own confirmation. A preview that also carried decisions would be a second
 * path into a state machine whose single path is the reason the transition service exists —
 * and the queue is deliberately opened in a new tab from here, so it and its filters survive
 * the trip.
 *
 * <h2>Motion</h2>
 *
 * None. docs/motion-system.md §8 forbids animation in long content outright: a paragraph
 * that fades in as it is scrolled past is a paragraph somebody is trying to read, and this
 * page is two thousand words of somebody trying to be read.
 */
export interface CampaignPreviewProps {
  readonly projectId: string;
  readonly copy: CampaignPreviewCopy;
}

export function CampaignPreview({ projectId, copy }: CampaignPreviewProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<ConsoleStatus>('loading');
  // #400: which of the two 403s this is. Only read while `status` is `forbidden`.
  const [capability, setCapability] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<CampaignPage | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus('loading');
      setNotFound(false);
      try {
        const page = await readCampaignPreview(projectId, controller.signal);
        if (controller.signal.aborted) return;

        /*
         * A response the reader could not narrow is treated as a campaign that is not
         * there. A half-built preview would be a decision taken against a page with holes
         * in it, which is the failure this screen exists to end rather than to reshape.
         */
        setNotFound(page === null);
        setCampaign(page);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        if (cause instanceof ApiError && cause.status === 404) {
          setNotFound(true);
          setStatus('ready');
          return;
        }
        const next = statusFor(cause);
        setCapability(requiredCapabilityFrom(cause));
        if (next === 'failed') setError(consoleMessageFor(cause, copy.subject, copy.refusals));
        setStatus(next);
      }
    }

    void load();
    return () => controller.abort();
    // `copy` is one object per server render; the language is a path segment, so a change
    // to it remounts this tree rather than re-running the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, attempt]);

  if (status === 'signed-out' || status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={status}
        capability={capability}
        subject={copy.subject}
        copy={copy.refusals}
      />
    );
  }

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loadingPreview}>
        <div className="rounded-xl border border-white/8 bg-surface-1 p-5">
          <Skeleton height="1.5rem" width="55%" />
          <Skeleton height="0.875rem" width="35%" className="mt-3" />
          <Skeleton height="0.875rem" width="70%" className="mt-2" />
        </div>
      </SkeletonGroup>
    );
  }

  if (notFound || campaign === null) {
    return (
      <EmptyState
        variant="empty"
        title={copy.notFoundTitle}
        description={copy.notFoundBody}
        action={<BackToDirectory label={copy.backToDirectory} />}
      />
    );
  }

  const launched = campaign.launchedAt === null ? null : formatDate(campaign.launchedAt, locale);
  const closes = campaign.deadline === null ? null : formatDate(campaign.deadline, locale);
  const isPublic = RENDERABLE_STATES.includes(campaign.state);

  return (
    <div>
      {error !== null && (
        <InlineAlert variant="danger" title={copy.errorTitle} className="mb-4">
          {error}
        </InlineAlert>
      )}

      {/*
        First, and never dismissible. This screen renders drafts, and a member of staff who
        has lost track of which tab they are in is one screenshot away from publishing
        somebody's unannounced project.
      */}
      <InlineAlert variant="info" title={copy.previewNoticeTitle}>
        {copy.previewNoticeBody}
      </InlineAlert>

      <section
        aria-labelledby="campaign-preview-heading"
        className="mt-6 rounded-xl border border-white/8 bg-surface-1 p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="campaign-preview-heading"
              className="text-lg font-medium tracking-[-0.02em] text-white"
            >
              {campaign.title}
            </h2>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-white/64">
              <span>{campaign.creator.name}</span>
              <span className="font-mono text-white/32" title={campaign.id}>
                {campaign.id.slice(0, 8)}
              </span>
              <CopyIdentifier id={campaign.id} copy={copy.identity} />
            </p>
          </div>
          {/*
            The state as a word, not as a colour — docs/ui-kit.md §9.2, and the reason the
            directory gives: there are sixteen of them and no palette distinguishes sixteen
            things, so none tries to.
          */}
          <span className="shrink-0 text-sm text-white/80">
            {copy.state[campaign.state] ?? campaign.state}
          </span>
        </div>

        {campaign.blurb !== null && (
          <p className="mt-3 max-w-[62ch] text-sm text-white/64">{campaign.blurb}</p>
        )}

        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Fact label={copy.goalLabel}>
            {campaign.goal === null ? copy.noGoal : formatMoney(campaign.goal)}
          </Fact>
          <Fact label={copy.raisedLabel}>{formatMoney(campaign.pledged)}</Fact>
          <Fact label={copy.backersLabel}>{campaign.backersCount}</Fact>
          <Fact label={copy.filedUnder}>
            {campaign.category === null ? copy.notFiled : campaign.category.name}
          </Fact>
          {launched !== null && (
            <Fact label={copy.launchedLabel}>
              <time dateTime={campaign.launchedAt ?? undefined}>{launched}</time>
            </Fact>
          )}
          {closes !== null && (
            <Fact label={copy.deadlineLabel}>
              <time dateTime={campaign.deadline ?? undefined}>{closes}</time>
            </Fact>
          )}
        </dl>

        {/*
          The public URL, offered only when there is one. A link to a page that answers 404
          is the defect this whole screen was filed about, so it is not repeated here in
          miniature: a campaign with no public page says so instead.
        */}
        <p className="mt-4 text-sm">
          {isPublic ? (
            <a
              className="rounded-lg text-white/64 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
              href={localeHref(
                `/projects/${encodeURIComponent(campaign.creatorSlug)}/${encodeURIComponent(campaign.slug)}`,
                locale,
              )}
              target="_blank"
              rel="noreferrer"
            >
              {copy.publicPage}
            </a>
          ) : (
            <span className="text-white/40">{copy.notPublicYet}</span>
          )}
        </p>
      </section>

      {campaign.coverImage !== null && (
        <div className="mt-6 overflow-hidden rounded-xl border border-white/8">
          <Image
            src={campaign.coverImage.url}
            alt={fillPlaceholders(copy.coverAlt, { title: campaign.title })}
            width={campaign.coverImage.width}
            height={campaign.coverImage.height}
            className="h-auto w-full"
            /*
             * Unoptimised, deliberately. The optimiser is a public cache keyed on the source
             * URL, and this is the one surface that renders covers belonging to campaigns
             * nobody outside the platform may see yet.
             */
            unoptimized
          />
        </div>
      )}

      <section aria-labelledby="campaign-preview-story" className="mt-8">
        <h2
          id="campaign-preview-story"
          className="text-lg font-medium tracking-[-0.02em] text-white"
        >
          {copy.storyHeading}
        </h2>
        {campaign.story === null ? (
          <p className="mt-2 max-w-[62ch] text-sm text-white/40">{copy.noStory}</p>
        ) : (
          <div className="mt-4">
            <CampaignStory story={campaign.story} title={campaign.title} copy={copy.story} />
          </div>
        )}
      </section>

      <section aria-labelledby="campaign-preview-risks" className="mt-8">
        <h2
          id="campaign-preview-risks"
          className="text-lg font-medium tracking-[-0.02em] text-white"
        >
          {copy.risksHeading}
        </h2>
        {/* §5.3 requires two hundred characters of it by submission; a draft may have none. */}
        {campaign.risks === null ? (
          <p className="mt-2 max-w-[62ch] text-sm text-white/40">{copy.noRisks}</p>
        ) : (
          <p className="mt-2 max-w-[68ch] wrap-anywhere whitespace-pre-line text-sm text-white/64">
            {campaign.risks}
          </p>
        )}
      </section>

      <p className="mt-8">
        <BackToDirectory label={copy.backToDirectory} />
      </p>

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
          {copy.tryAgain}
        </Pill>
      )}
    </div>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-white/40">{label}</dt>
      <dd className="text-white/80">{children}</dd>
    </div>
  );
}

function BackToDirectory({ label }: { readonly label: string }) {
  return (
    <Link
      href="/admin/campaigns"
      className="rounded-lg text-sm text-white/64 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
    >
      {label}
    </Link>
  );
}
