'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import {
  readAccountSubscriptions,
  readUser,
  readUserPledges,
  type AdminAccountSubscriptions,
  type AdminUser,
  type AdminUserPledge,
} from '../../lib/admin/api';
import type { ConsoleSubscription } from '../../lib/admin/plans';
import {
  DIRECTORY_PAGE_SIZE,
  listCampaigns,
  type DirectoryCampaign,
} from '../../lib/admin/campaigns';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { AccountDetailCopy } from '../../lib/i18n/admin/people-copy';
import { Link, localeHref } from '../../i18n/navigation';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate } from '../../lib/time';
import { formatMoney } from '../../lib/money';
import type { Locale } from '../../lib/i18n/locale';
import { ConsoleRefusal } from './ConsoleRefusal';
import { CopyIdentifier } from './ConsoleIdentity';

/**
 * §4.11's AD-04, one account — issue #404.
 *
 * <h2>The screen a suspension was being decided without</h2>
 *
 * `/admin/users` listed accounts and offered one control per row: suspend. No link, no
 * detail, no history. Its own copy told a moderator that suspending somebody "changes nothing
 * about the campaigns they created or the pledges they made" — which is precisely the context
 * needed to decide whether to do it — and there was no user detail screen anywhere in the
 * console to see any of it. A moderator stopped an account on a name, an email address and
 * two tags.
 *
 * <p>So this is not a new capability. Every fact on it was already served: the standing by
 * `GET /v1/admin/users/{id}`, which #104 shipped and nothing ever called; the campaigns by
 * the directory's new `creatorId` filter; the pledges by an endpoint that reuses the list a
 * backer sees of themselves. What was missing was a page that put them in one place, at the
 * moment the decision is taken.
 *
 * <h2>Three reads, and a failure in one does not empty the page</h2>
 *
 * The account is the page: if it cannot be read there is nothing to show, and the screen says
 * so. The campaigns and the pledges are two independent panels below it, each with its own
 * request and its own error — a moderator whose pledge read timed out should still be able to
 * see what this person has created, and a single combined status would hide both behind
 * whichever failed.
 *
 * <p>They are also not fetched in sequence. The campaigns and the pledges are asked for
 * together as soon as the account resolves, because they are two questions about the same
 * person and nothing about the second depends on the first.
 *
 * <h2>No decision is taken here</h2>
 *
 * Suspending stays on the directory, with its confirmation dialog and its required reason.
 * This screen exists so that the decision made there is an informed one; putting a second ban
 * control on it would mean two paths into an audited, session-revoking write, and the second
 * one would be the one without the dialog. The link back is the whole affordance.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 gives an administrative surface 150ms of colour on a control and
 * nothing else, and §8 forbids animation in lists. This is a page of two lists about a person
 * who is about to be stopped.
 */
export interface AccountDetailProps {
  readonly userId: string;
  readonly copy: AccountDetailCopy;
}

/** The day, in the reader's language. An instant to the second says more than anybody needs. */
function day(instant: string | null | undefined, locale: Locale): string | null {
  return instant == null ? null : formatDate(instant, locale);
}

export function AccountDetail({ userId, copy }: AccountDetailProps) {
  const locale = useRouteLocale();

  const [status, setStatus] = useState<ConsoleStatus>('loading');
  // #400: which of the two 403s this is. Only read while `status` is `forbidden`.
  const [capability, setCapability] = useState<string | null>(null);
  const [account, setAccount] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus('loading');
      try {
        const found = await readUser(userId, controller.signal);
        if (controller.signal.aborted) return;

        setAccount(found);
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
  }, [userId, attempt]);

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

  return (
    <div>
      {/* A link and not a `Pill`: the kit's pill is a button, and going back is navigation.
          The same control `CampaignPreview` uses to return to its own directory. */}
      <Link
        href="/admin/users"
        className="rounded-lg text-sm text-white/64 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
      >
        {copy.backToDirectory}
      </Link>

      {status === 'loading' && (
        <SkeletonGroup label={copy.loadingAccount} className="mt-6">
          <div className="rounded-lg border border-white/8 bg-surface-2 p-5">
            <Skeleton height="1.25rem" width="35%" />
            <Skeleton height="0.875rem" width="50%" className="mt-3" />
            <Skeleton height="0.875rem" width="25%" className="mt-2" />
          </div>
        </SkeletonGroup>
      )}

      {status === 'failed' && (
        <>
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-6">
            {error}
          </InlineAlert>
          <Pill variant="ghost" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
            {copy.tryAgain}
          </Pill>
        </>
      )}

      {status === 'ready' && account !== null && (
        <>
          <Standing account={account} locale={locale} copy={copy} />
          {/*
            Rendered only once the account has resolved, so that a 404 for somebody who does
            not exist is one refusal rather than three. Keyed by the identifier for the
            ordinary reason: navigating from one account to another must not leave the
            previous person's pledges on screen while the next request is in flight.
          */}
          <CreatedCampaigns key={`campaigns-${account.id}`} userId={account.id} locale={locale} copy={copy} />
          <BackedPledges key={`pledges-${account.id}`} userId={account.id} locale={locale} copy={copy} />
          <HeldSubscriptions
            key={`subscriptions-${account.id}`}
            userId={account.id}
            locale={locale}
            copy={copy}
          />
        </>
      )}
    </div>
  );
}

/**
 * Who this is, and where they stand.
 *
 * <p>The address is here for the reason the directory renders one: this is the only surface
 * on the platform that shows somebody else's, which is why every read of it is audited.
 *
 * <p><strong>The suspension reason is shown in full.</strong> It is what the person was told
 * and what an appeal is answered from, so a moderator reading this page before deciding
 * anything else needs to see the words rather than the fact that words exist.
 */
function Standing({
  account,
  locale,
  copy,
}: {
  readonly account: AdminUser;
  readonly locale: Locale;
  readonly copy: AccountDetailCopy;
}) {
  return (
    <section aria-labelledby="account-standing-heading" className="mt-6">
      <div className="rounded-lg border border-white/8 bg-surface-2 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="account-standing-heading"
              className="truncate text-lg font-medium tracking-[-0.02em] text-white"
            >
              {account.name}
            </h2>
            <p className="truncate text-sm text-white/64">{account.email}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-white/40">
              <span className="truncate">
                /{account.slug} ·{' '}
                {fillPlaceholders(copy.joined, {
                  date: day(account.createdAt, locale) ?? copy.unknownDate,
                })}
              </span>
              <span className="font-mono text-white/32" title={account.id}>
                {account.id.slice(0, 8)}
              </span>
              <CopyIdentifier id={account.id} copy={copy.identity} />
            </p>
          </div>

          {/* Never colour alone: each state is a word as well as a tone — docs/ui-kit.md §9.2. */}
          <div className="flex flex-wrap items-center gap-2">
            <Tag variant={account.emailVerified ? 'success' : 'default'}>
              {account.emailVerified ? copy.emailVerified : copy.emailUnverified}
            </Tag>
            {account.suspended && <Tag variant="danger">{copy.suspendedTag}</Tag>}
            {account.deletionScheduledAt !== null && <Tag variant="warning">{copy.leaving}</Tag>}
          </div>
        </div>

        {account.suspended && (
          <p className="mt-3 text-sm text-white/64">
            {fillPlaceholders(copy.suspendedOn, {
              date: day(account.suspendedAt, locale) ?? copy.unknownDate,
            })}
            {account.suspensionReason !== null && `: ${account.suspensionReason}`}
          </p>
        )}

        {account.deletionScheduledAt !== null && (
          <p className="mt-2 text-sm text-white/48">
            {fillPlaceholders(copy.leavingOn, {
              date: day(account.deletionScheduledAt, locale) ?? copy.unknownDate,
            })}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * What this person has created.
 *
 * <p>The campaign directory's own endpoint, narrowed to one creator — so the states, the
 * ordering and the funding figures are the ones that screen shows, and a moderator who has
 * read one has read the other. Every state, including drafts: a campaign nobody has published
 * is still something this account made, and a suspension that "changes nothing about the
 * campaigns they created" is a sentence somebody should be able to check.
 */
function CreatedCampaigns({
  userId,
  locale,
  copy,
}: {
  readonly userId: string;
  readonly locale: Locale;
  readonly copy: AccountDetailCopy;
}) {
  const [campaigns, setCampaigns] = useState<readonly DirectoryCampaign[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const page = await listCampaigns({
          creatorId: userId,
          limit: DIRECTORY_PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setCampaigns(page.campaigns);
        setCursor(page.nextCursor ?? null);
        setFailed(false);
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;
        /*
         * A panel that failed says so and nothing more. The two refusals this could be —
         * signed out, or short of `MODERATE_CONTENT` while holding the account capability —
         * are both about a panel beside a page that rendered, and `ConsoleRefusal`'s sentences
         * are written for a whole screen. Somebody who can read the account and not the
         * campaigns is told the panel could not be read, which is true and actionable.
         */
        setFailed(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [userId]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await listCampaigns({
        creatorId: userId,
        after: cursor,
        limit: DIRECTORY_PAGE_SIZE,
      });
      setCampaigns((previous) => [...(previous ?? []), ...page.campaigns]);
      setCursor(page.nextCursor ?? null);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, userId]);

  return (
    <section aria-labelledby="account-campaigns-heading" className="mt-8">
      <h2
        id="account-campaigns-heading"
        className="text-base font-medium tracking-[-0.02em] text-white"
      >
        {copy.campaignsHeading}
      </h2>

      {failed && (
        <InlineAlert variant="warning" className="mt-3">
          {copy.campaignsFailed}
        </InlineAlert>
      )}

      {!failed && campaigns === null && (
        <SkeletonGroup label={copy.loadingCampaigns} className="mt-3">
          <div className="space-y-2">
            {[0, 1].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="45%" />
                <Skeleton height="0.875rem" width="30%" className="mt-2" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {!failed && campaigns !== null && campaigns.length === 0 && (
        <EmptyState className="mt-3" variant="empty" title={copy.noCampaignsTitle} description={copy.noCampaignsBody} />
      )}

      {!failed && campaigns !== null && campaigns.length > 0 && (
        <ul className="mt-3 flex list-none flex-col gap-2">
          {campaigns.map((campaign) => (
            <li key={campaign.projectId} className="rounded-lg border border-white/8 bg-surface-1 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* The staff preview, not the public page: half of these states have no
                      public page at all, so a public link would be a 404 by construction. */}
                  <a
                    href={localeHref(`/admin/campaigns/${encodeURIComponent(campaign.projectId)}`, locale)}
                    className="text-[15px] font-medium text-white underline-offset-4 hover:underline"
                  >
                    {campaign.title}
                  </a>
                  <p className="mt-1 text-sm text-white/48">
                    {fillPlaceholders(copy.startedOn, {
                      date: day(campaign.createdAt, locale) ?? copy.unknownDate,
                    })}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Tag>{copy.state[campaign.state] ?? campaign.state}</Tag>
                  <span className="text-sm text-white/64">
                    {formatMoney(campaign.pledged)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/*
        Paged rather than capped at one read. A prolific creator is exactly the account a
        moderator is most likely to be looking at, and "the newest twenty-five and no way to
        see the rest" is a screen that answers "what have they created" with a guess.
      */}
      {!failed && cursor !== null && (
        <Pill
          variant="ghost"
          size="sm"
          className="mt-3"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? copy.loading : copy.loadMore}
        </Pill>
      )}
    </section>
  );
}

/**
 * What this person has backed.
 *
 * <p>Every state of §6.2's twelve, because a cancelled pledge and one whose card was refused
 * are facts about the account rather than noise — and on this screen they are among the more
 * interesting ones.
 *
 * <p>The campaign is named where it can be. A pledge whose campaign row is gone keeps its row
 * and loses the link: it is still the person's money, and blanking it would leave a total
 * attached to nothing.
 */
function BackedPledges({
  userId,
  locale,
  copy,
}: {
  readonly userId: string;
  readonly locale: Locale;
  readonly copy: AccountDetailCopy;
}) {
  const [pledges, setPledges] = useState<readonly AdminUserPledge[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const page = await readUserPledges(userId, null, controller.signal);
        if (controller.signal.aborted) return;

        setPledges(page.pledges);
        setCursor(page.nextCursor);
        setFailed(false);
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;
        setFailed(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [userId]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await readUserPledges(userId, cursor);
      setPledges((previous) => [...(previous ?? []), ...page.pledges]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, userId]);

  return (
    <section aria-labelledby="account-pledges-heading" className="mt-8">
      <h2
        id="account-pledges-heading"
        className="text-base font-medium tracking-[-0.02em] text-white"
      >
        {copy.pledgesHeading}
      </h2>

      {failed && (
        <InlineAlert variant="warning" className="mt-3">
          {copy.pledgesFailed}
        </InlineAlert>
      )}

      {!failed && pledges === null && (
        <SkeletonGroup label={copy.loadingPledges} className="mt-3">
          <div className="space-y-2">
            {[0, 1].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="50%" />
                <Skeleton height="0.875rem" width="25%" className="mt-2" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {!failed && pledges !== null && pledges.length === 0 && (
        <EmptyState className="mt-3" variant="empty" title={copy.noPledgesTitle} description={copy.noPledgesBody} />
      )}

      {!failed && pledges !== null && pledges.length > 0 && (
        <ul className="mt-3 flex list-none flex-col gap-2">
          {pledges.map((pledge) => (
            <li key={pledge.pledgeId} className="rounded-lg border border-white/8 bg-surface-1 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {pledge.project == null ? (
                    <p className="text-[15px] font-medium text-white/64">{copy.campaignGone}</p>
                  ) : (
                    <a
                      href={localeHref(
                        `/admin/campaigns/${encodeURIComponent(pledge.project.id)}`,
                        locale,
                      )}
                      className="text-[15px] font-medium text-white underline-offset-4 hover:underline"
                    >
                      {pledge.project.title}
                    </a>
                  )}
                  <p className="mt-1 text-sm text-white/48">
                    {pledge.confirmedAt != null
                      ? fillPlaceholders(copy.backedOn, {
                          date: day(pledge.confirmedAt, locale) ?? copy.unknownDate,
                        })
                      : copy.neverConfirmed}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Tag>{copy.pledgeState[pledge.state] ?? pledge.state}</Tag>
                  <span className="text-sm text-white/64">
                    {formatMoney(pledge.amounts.total)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!failed && cursor !== null && (
        <Pill
          variant="ghost"
          size="sm"
          className="mt-3"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? copy.loading : copy.loadMore}
        </Pill>
      )}
    </section>
  );
}

/**
 * What the account has held and paid the platform — #23.
 *
 * <p><strong>Its own read, and its own failure.</strong> The same arrangement as the pledges
 * above: a moderator deciding about somebody's account must not lose the standing panel
 * because the subscription service answered badly, so this section says it could not be read
 * and the rest of the page stays what it is.
 *
 * <p><strong>`entitled` decides the label, not `state` alone.</strong> A subscription whose
 * period has run out is still `ACTIVE` in the table until something retires it — V62 argues
 * why no job does — so an `ACTIVE` row that no longer entitles is drawn as expired. Reading
 * `state` alone would tell a moderator that somebody can publish who cannot.
 *
 * <p>Unpaged, because the service is: a monthly plan is twelve of each a year.
 */
function HeldSubscriptions({
  userId,
  locale,
  copy,
}: {
  readonly userId: string;
  readonly locale: Locale;
  readonly copy: AccountDetailCopy;
}) {
  const [history, setHistory] = useState<AdminAccountSubscriptions | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const found = await readAccountSubscriptions(userId, controller.signal);
        if (controller.signal.aborted) return;

        setHistory(found);
        setFailed(false);
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;
        setFailed(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [userId]);

  const nothing = history !== null && history.subscriptions.length === 0 && history.payments.length === 0;

  return (
    <section aria-labelledby="account-subscriptions-heading" className="mt-8">
      <h2
        id="account-subscriptions-heading"
        className="text-base font-medium tracking-[-0.02em] text-white"
      >
        {copy.subscriptionsHeading}
      </h2>

      {failed && (
        <InlineAlert variant="warning" className="mt-3">
          {copy.subscriptionsFailed}
        </InlineAlert>
      )}

      {!failed && history === null && (
        <SkeletonGroup label={copy.loadingSubscriptions} className="mt-3">
          <div className="rounded-lg border border-white/8 bg-surface-1 p-4">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="0.875rem" width="30%" className="mt-2" />
          </div>
        </SkeletonGroup>
      )}

      {!failed && nothing && (
        <EmptyState
          className="mt-3"
          variant="empty"
          title={copy.noSubscriptionsTitle}
          description={copy.noSubscriptionsBody}
        />
      )}

      {!failed && history !== null && !nothing && (
        <>
          {history.subscriptions.length > 0 && (
            <ul className="mt-3 flex list-none flex-col gap-2">
              {history.subscriptions.map((subscription) => (
                <li key={subscription.id} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-white">
                        {subscription.planName ?? subscription.planCode ?? subscription.id}
                      </p>
                      <p className="mt-1 text-sm text-white/48">{windowOf(subscription, locale, copy)}</p>
                      {subscription.cancelAtPeriodEnd && subscription.entitled && (
                        <p className="mt-1 text-sm text-white/48">{copy.notRenewing}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag>{stateLabelOf(subscription, copy)}</Tag>
                      <span className="text-sm text-white/64">
                        {formatMoney({ amount: subscription.price, currency: subscription.currency })}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-5 text-sm font-medium text-white">{copy.paymentsHeading}</h3>
          {history.payments.length === 0 ? (
            <p className="mt-2 text-sm text-white/48">{copy.noPaymentsBody}</p>
          ) : (
            <ul className="mt-2 flex list-none flex-col gap-2">
              {history.payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-surface-1 px-4 py-3"
                >
                  <span className="min-w-0 text-sm text-white/64">
                    {payment.planName} · {copy.paymentMethod[payment.method] ?? payment.method} ·{' '}
                    {fillPlaceholders(copy.paymentReceived, {
                      date: day(payment.receivedAt, locale) ?? copy.unknownDate,
                    })}
                  </span>
                  <span className="flex items-center gap-2">
                    {/* The word, beside the negative amount, so a reversal is not carried by a sign alone. */}
                    {payment.reversal && <Tag>{copy.reversal}</Tag>}
                    <span className="text-sm text-white">
                      {formatMoney({ amount: payment.amount, currency: payment.currency })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** The state a moderator should read: an `ACTIVE` row that no longer entitles has expired. */
function stateLabelOf(subscription: ConsoleSubscription, copy: AccountDetailCopy): string {
  const state = subscription.state === 'ACTIVE' && !subscription.entitled ? 'EXPIRED' : subscription.state;
  return copy.subscriptionState[state] ?? state;
}

/** The period it covers, or when it was chosen if nothing has been paid yet. */
function windowOf(subscription: ConsoleSubscription, locale: Locale, copy: AccountDetailCopy): string {
  const from = day(subscription.startedAt, locale);
  const to = day(subscription.currentPeriodEnd, locale);
  if (from !== null && to !== null) {
    return fillPlaceholders(copy.subscriptionWindow, { from, to });
  }
  return fillPlaceholders(copy.subscriptionChosen, { date: day(subscription.createdAt, locale) ?? copy.unknownDate });
}
