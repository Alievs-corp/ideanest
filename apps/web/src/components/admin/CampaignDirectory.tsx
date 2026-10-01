'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Chip,
  ChipRow,
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  TextInput,
} from '@ideanest/ui';
import {
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_STATES,
  listCampaigns,
  type DirectoryCampaign,
} from '../../lib/admin/campaigns';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  shortId,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import type { ProjectState } from '../../lib/projects/api';
import type { CampaignDirectoryCopy } from '../../lib/i18n/admin/content-copy';
import { CopyIdentifier } from './ConsoleIdentity';
import { localeHref } from '../../i18n/navigation';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate } from '../../lib/time';
import { formatMoney } from '../../lib/money';
import type { Locale } from '../../lib/i18n/locale';
import { ConsoleCount } from './ConsoleCount';
import { ConsoleRefusal } from './ConsoleRefusal';

/**
 * §4.11's campaign directory: what campaigns exist — issue #387.
 *
 * <h2>Why the console needed this screen</h2>
 *
 * Every other way into a campaign starts from something the campaign did. A report
 * somebody filed about it reaches the moderation queue; being submitted reaches the
 * review queue; being suspended needs an identifier a member of staff already has. A
 * campaign that is simply a draft, or simply live, or that was cleared for launch a week
 * ago and has not launched, was in none of them. The console could operate a campaign and
 * could not find one.
 *
 * <h2>Newest first, where the review queue is oldest first</h2>
 *
 * Not a preference, and the same distinction `AuditTrailView` draws. A queue is worked
 * from the front, because the thing that has waited longest is the thing that matters. A
 * directory is read from the end: what has just been started, what launched this week.
 *
 * <h2>The filter reaches the service</h2>
 *
 * There is deliberately no client-side narrowing. Twenty-five campaigns of which two are
 * drafts is not a page of two, and a chip that filtered the loaded page would report a
 * count about the page while appearing to report one about the platform.
 *
 * <h2>Nothing here changes anything</h2>
 *
 * The three moderation outcomes are on the review queue, where the campaigns they apply to
 * are; suspension is its own screen with its own confirmation. A directory that also
 * carried decisions would be a second path into a state machine whose single path is the
 * point of it.
 *
 * <h2>Motion</h2>
 *
 * None. docs/motion-system.md §5 gives an administrative surface 150ms of colour on a
 * control and §8 forbids animation in long lists. This is both.
 */

/**
 * The day, in the reader's language. An instant to the second says more than anybody needs.
 *
 * <p>`toLocaleDateString()` with no argument until #401, which is the *browser's* language
 * rather than the route's — so an Azerbaijani console on an American laptop rendered
 * `9/1/2026` under a heading in Azerbaijani.
 */
function day(instant: string | null | undefined, locale: Locale): string | null {
  return instant == null ? null : formatDate(instant, locale);
}

export interface CampaignDirectoryProps {
  /** Every word this screen draws, resolved by the route on the server. */
  readonly copy: CampaignDirectoryCopy;
}

export function CampaignDirectory({ copy }: CampaignDirectoryProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<ConsoleStatus>('loading');
  // #400: which of the two 403s this is. Only read while `status` is `forbidden`.
  const [capability, setCapability] = useState<string | null>(null);
  const [state, setState] = useState<ProjectState | null>(null);
  /*
   * #404's search, and it is a form rather than a keystroke handler — the rule
   * `UserDirectory` set for the account directory next door. `term` is what is in the box;
   * `search` is what has been asked for. Two pieces of state rather than one, because a
   * request per character would be a request per character against a contains-match over
   * `projects` joined to `users`, which is the scan `CampaignDirectoryRows` says is
   * affordable once per intention and not once per keypress.
   */
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [campaigns, setCampaigns] = useState<readonly DirectoryCampaign[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus('loading');
      try {
        const page = await listCampaigns({
          state,
          query: search,
          limit: DIRECTORY_PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setCampaigns(page.campaigns);
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
    // `copy` is one object per server render and changes only with the language, which is a
    // path segment and remounts this tree rather than re-running this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, search, attempt]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || loadingMore) return;

    setLoadingMore(true);
    setError(null);
    try {
      const page = await listCampaigns({
        state,
        query: search,
        after: cursor,
        limit: DIRECTORY_PAGE_SIZE,
      });
      setCampaigns((previous) => [...previous, ...page.campaigns]);
      setCursor(page.nextCursor ?? null);
    } catch (cause) {
      setError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, state, search, copy]);

  if (status === 'signed-out' || status === 'forbidden') {
    return <ConsoleRefusal status={status} capability={capability} subject={copy.subject} copy={copy.refusals} />;
  }

  return (
    <section aria-labelledby="campaign-directory-heading">
      <h2 id="campaign-directory-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.heading}
        {status === 'ready' && (
          <ConsoleCount loaded={campaigns.length} more={cursor !== null} copy={copy.count} />
        )}
      </h2>

      {/*
        #404: the screen that lists campaigns in every state had no input of any kind, so
        finding one among hundreds meant paging through sixteen chips and reading. The account
        directory has had a search box since #104 and shows it is not hard.

        A form and not a keystroke handler, for the reason the state above gives. Submitting an
        empty box clears the search, which is why there is no separate "clear" control: the
        box is the control.
      */}
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(term.trim());
        }}
      >
        <Field label={copy.searchLabel} hint={copy.searchHint} className="min-w-[260px] flex-1">
          <TextInput
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </Field>
        <Pill type="submit" variant="ghost" size="sm" className="mb-1">
          {copy.search}
        </Pill>
        {search !== '' && (
          <Pill
            variant="ghost"
            size="sm"
            className="mb-1"
            onClick={() => {
              setTerm('');
              setSearch('');
            }}
          >
            {copy.clearSearch}
          </Pill>
        )}
      </form>

      {/* Every chip here reaches the service — see the docblock on why nothing is narrowed
          in the browser. */}
      <ChipRow aria-label={copy.filterLabel} className="mt-3">
        <Chip active={state === null} onClick={() => setState(null)}>
          {copy.everything}
        </Chip>
        {DIRECTORY_STATES.map((option) => (
          <Chip key={option} active={state === option} onClick={() => setState(option)}>
            {copy.state[option] ?? option}
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
          <div className="space-y-4">
            {[0, 1, 2].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-2 p-5">
                <Skeleton height="1.125rem" width="40%" />
                <Skeleton height="0.875rem" width="60%" className="mt-3" />
                <Skeleton height="0.875rem" width="30%" className="mt-2" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && campaigns.length === 0 && (
        <EmptyState
          className="mt-4"
          /* A search narrows the list exactly as a state chip does, so a page of nothing
             under one is "nothing matched", not "there are no campaigns" — #404. */
          variant={state === null && search === '' ? 'empty' : 'filtered'}
          title={state === null && search === '' ? copy.emptyTitle : copy.filteredTitle}
          description={state === null && search === '' ? copy.emptyBody : copy.filteredBody}
        />
      )}

      {status === 'ready' && campaigns.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-4">
          {campaigns.map((campaign) => (
            <CampaignRow key={campaign.projectId} campaign={campaign} locale={locale} copy={copy} />
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

interface CampaignRowProps {
  readonly campaign: DirectoryCampaign;
  /** Narrowed from `string` with #401: it now decides how a date reads, not only a URL. */
  readonly locale: Locale;
  readonly copy: CampaignDirectoryCopy;
}

/**
 * One campaign.
 *
 * <p>The heading links to the campaign's own page, because every question this row cannot
 * answer is on it. A campaign whose creator has been anonymised keeps its row and loses
 * the link to a profile — §17.4 removes the person, not the campaign.
 */
function CampaignRow({ campaign, locale, copy }: CampaignRowProps) {
  /*
   * The staff preview, not the public page — issue #399.
   *
   * This directory is the one screen that lists campaigns in every state, so the public URL
   * was a 404 for a good half of the rows on it: a draft, a submission awaiting review, a
   * rejected campaign and a suspended one all have no public page, and every one of them is
   * a row here. `/admin/campaigns/{id}` renders the same page a backer would see, whatever
   * state the campaign is in, and it exists on the console rather than being a wider version
   * of the public route.
   */
  const href = localeHref(`/admin/campaigns/${encodeURIComponent(campaign.projectId)}`, locale);

  const started = day(campaign.createdAt, locale);
  const launched = day(campaign.launchedAt, locale);
  const closes = day(campaign.deadline, locale);

  return (
    <li className="rounded-lg border border-white/8 bg-surface-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium text-white">
            <a className="underline-offset-4 hover:underline" href={href}>
              {campaign.title}
            </a>
          </h3>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-white/64">
            {/*
              The creator's account, so the person behind a campaign — their standing, their
              other campaigns, their VÖEN and business card — is one click from the row. An
              anonymised creator has no account to open and keeps the plain placeholder.
            */}
            {campaign.creatorName == null ? (
              <span>{copy.creatorGone}</span>
            ) : (
              <a
                className="underline-offset-4 hover:underline"
                href={localeHref(`/admin/users/${encodeURIComponent(campaign.creatorId)}`, locale)}
              >
                {campaign.creatorName}
              </a>
            )}
            {/*
              #402: four console screens take a campaign identifier typed by hand — the
              payout calculator, the ledger filter, the refund console and the payment log —
              and this is the one screen that lists campaigns in every state. Copying it
              from here is what makes those four reachable without a psql session.
            */}
            <span className="font-mono text-white/32" title={campaign.projectId}>
              {shortId(campaign.projectId)}
            </span>
            <CopyIdentifier id={campaign.projectId} copy={copy.identity} />
          </p>
        </div>
        {/*
          The state as a word, not as a colour. docs/ui-kit.md §9.2: colour alone never
          carries meaning, and there are sixteen states here — no palette distinguishes
          them, so none tries to.
        */}
        <span className="shrink-0 text-sm text-white/80">
          {copy.state[campaign.state] ?? campaign.state}
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-white/40">{copy.goalLabel}</dt>
          <dd className="text-white/80">
            {campaign.goal == null ? copy.noGoal : formatMoney(campaign.goal)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-white/40">{copy.raisedLabel}</dt>
          <dd className="text-white/80">
            {formatMoney(campaign.pledged)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-white/40">{copy.backersLabel}</dt>
          <dd className="text-white/80">{campaign.backersCount}</dd>
        </div>
        {started !== null && (
          <div className="flex gap-2">
            <dt className="text-white/40">{copy.startedLabel}</dt>
            <dd className="text-white/80">
              <time dateTime={campaign.createdAt}>{started}</time>
            </dd>
          </div>
        )}
        {/*
          Launched and closes are drawn only once they exist. A campaign that has never
          launched has no deadline — §5.3 computes it from the launch instant — and an
          empty row under a label reads as a missing value rather than as an absent event.
        */}
        {launched !== null && (
          <div className="flex gap-2">
            <dt className="text-white/40">{copy.launchedLabel}</dt>
            <dd className="text-white/80">
              <time dateTime={campaign.launchedAt ?? undefined}>{launched}</time>
            </dd>
          </div>
        )}
        {closes !== null && (
          <div className="flex gap-2">
            <dt className="text-white/40">{copy.deadlineLabel}</dt>
            <dd className="text-white/80">
              <time dateTime={campaign.deadline ?? undefined}>{closes}</time>
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}
