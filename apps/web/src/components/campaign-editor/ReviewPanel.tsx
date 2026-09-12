'use client';

import { Link, useRouter } from '../../i18n/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { InlineAlert, Pill, ProgressBar, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  getProjectChecklist,
  launchProject,
  submitProject,
  type ChecklistItem,
  type ProjectChecklist,
  type ProjectState,
} from '../../lib/projects/api';
import {
  describeProgress,
  isChecklistSection,
  progressOf,
  sectionHref,
  unmetFromRefusal,
  unmetOf,
  type UnmetRequirement,
} from '../../lib/projects/checklist';
import type {
  EditorChromeCopy,
  ReviewNotedState,
  ReviewPanelCopy,
} from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { EditorShell } from './EditorShell';
import { useProjectEdit } from './useProjectEdit';

/**
 * The review tab: how complete the campaign is, what moderation last said about
 * it, and the control that sends it for review.
 *
 * <h3>THE SERVER IS THE AUTHORITY, NOT THIS SCREEN</h3>
 *
 * The checklist is read when the tab opens. `POST /submit` re-checks the same
 * rules server-side with the same class, so the two normally agree — but the read
 * is a snapshot, a collaborator may have emptied a field since, and a deployment
 * may enforce a rule this build has never heard of. So a refusal is rendered from
 * the requirements the SERVER named and the stale list is replaced, rather than
 * the creator being shown a screen that says everything is fine beside a message
 * that says it is not.
 *
 * That is also why there is no copy of §5.3 here. `basics.ts` validates on the
 * client because a creator typing needs an answer in the same second; nothing on
 * this screen is being typed, and a second implementation of the rules would only
 * be a second thing that could disagree.
 *
 * <h3>BLOCKING AND ADVISORY ARE DISTINGUISHED BY MORE THAN COLOUR</h3>
 *
 * Two headed groups, two icon shapes, and a spoken status on every row
 * (docs/ui-kit.md §9.2). A checklist rendered only in red and green tells a
 * creator with a colour-vision deficiency nothing at all, and tells everybody else
 * that a suggestion is a barrier.
 *
 * <h3>THE SCORE IS A SENTENCE FIRST</h3>
 *
 * The bar is `aria-hidden`: it is a picture of the number that the sentence beside
 * it already carries, and `role="progressbar"` announced alongside "83% complete.
 * 10 of 10 required items done" is the same fact twice. The counts are the part
 * that matters, because they are what says whether the remainder is optional.
 *
 * MOTION: none. `docs/motion-system.md` §5 gives the campaign editor "none —
 * autosave indicator only", and nothing on this tab autosaves.
 */

const LOADING_ROWS = [0, 1, 2, 3];

/**
 * The states from which submitting is an action worth offering.
 *
 * A PRESENTATION DECISION, NOT A RULE. §6.1 is enforced server-side and there is
 * deliberately no client-side transition table; this only decides whether to draw
 * a button, because "Submit for review" under a live campaign is nonsense rather
 * than a refusal worth letting somebody discover. Anything this list is wrong
 * about becomes a 409 the panel renders, which is the same outcome as never having
 * had the list.
 */
const SUBMITTABLE_FROM: readonly ProjectState[] = ['DRAFT', 'PRELAUNCH', 'CHANGES_REQUESTED'];

/**
 * The states from which launching is an action worth offering.
 *
 * The same presentation decision {@link SUBMITTABLE_FROM} is, and §6.1's own pair:
 * a moderator clears a campaign into `APPROVED`, and `SCHEDULED` is that campaign
 * waiting for a time it may still be taken past. Everything else the server
 * refuses, and the refusal is rendered.
 */
const LAUNCHABLE_FROM: readonly ProjectState[] = ['APPROVED', 'SCHEDULED'];

/** What a campaign in this state is waiting for, said plainly. */

interface Refusal {
  message: string;
  /** Named by the server. Replaces what this screen was showing; see the note above. */
  unmet: readonly UnmetRequirement[];
  /**
   * The plan bound that refused this, when one did.
   *
   * <p>Rendered rather than redirected to, unlike `SUBSCRIPTION_REQUIRED` — see `submit`.
   */
  limit?: { plan: string; allowed: string; actual: string };
}

export interface ReviewPanelProps {
  projectId: string;
  /** The editor frame's words, resolved by this tab's page. */
  copy: EditorChromeCopy;
  /** This tab's own words. */
  review: ReviewPanelCopy;
}

export function ReviewPanel({ projectId, copy, review: words }: ReviewPanelProps) {
  /*
   * Two reads on open, deliberately. The shell needs the campaign's title and the
   * review needs the checklist, and they are different resources — folding the
   * checklist into `ProjectEdit` would put a query on `project_state_transitions`
   * behind every autosave in every other tab.
   */
  const { project, status, error, reload, apply } = useProjectEdit(projectId);
  const router = useRouter();

  const [checklist, setChecklist] = useState<ProjectChecklist | null>(null);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [launching, setLaunching] = useState(false);
  const [confirmingLaunch, setConfirmingLaunch] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const blockingHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const loaded = await getProjectChecklist(projectId, controller.signal);
        if (controller.signal.aborted) return;
        setChecklist(loaded);
        setChecklistError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setChecklistError(messageFor(cause, words));
      }
    })();

    return () => controller.abort();
  }, [projectId, attempt]);

  const reloadAll = useCallback(() => {
    setRefusal(null);
    setLaunchError(null);
    setAttempt((n) => n + 1);
    reload();
  }, [reload]);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setRefusal(null);
    try {
      apply(await submitProject(projectId));
      // The checklist is re-read rather than assumed: the state has changed, and
      // with it the moderation outcome's `current` flag.
      setAttempt((n) => n + 1);
    } catch (cause) {
      /*
       * SUBSCRIPTION_REQUIRED IS THE ONE REFUSAL THIS SCREEN CANNOT ANSWER.
       *
       * Everything else the server says no to is something on this campaign, and the
       * panel renders it beside the thing to fix. A creator with no plan has nothing
       * to fix here: what is missing is not on the campaign, so the answer is the
       * pricing page and the panel takes them there.
       *
       * `from` and `project` are what let that page explain itself — a banner saying
       * why they are looking at a price list, and a link back to this tab. Arriving
       * at prices with no account of what you did to deserve them is the failure
       * those two parameters exist to prevent.
       *
       * PLAN_LIMIT_EXCEEDED deliberately does NOT navigate. That creator has paid,
       * and the answer may be to withdraw a campaign or lower a goal rather than to
       * buy anything; sending a paying customer to a price list reads as the platform
       * trying to sell them something instead of answering them.
       */
      if (cause instanceof ApiError && cause.problem?.code === 'SUBSCRIPTION_REQUIRED') {
        router.push(`/pricing?from=submit&project=${encodeURIComponent(projectId)}`);
        return;
      }
      setRefusal(refusalFrom(cause, words));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * `APPROVED` or `SCHEDULED` → `LIVE`, on the creator's word.
   *
   * <p>No checklist re-read stands between the confirmation and the request: §5.3
   * was satisfied to reach `APPROVED` and a moderator has read the campaign since.
   * What the server can still refuse — a goal or a duration cleared while the
   * campaign sat in review — comes back as a message and is rendered beside the
   * control, which is the same contract `submit` has.
   *
   * <p>The dialog is closed only on success. A failure leaves it open with the
   * reason under it, because closing it would return the creator to a screen that
   * looks exactly as it did before they pressed anything.
   */
  async function launch(): Promise<void> {
    setLaunching(true);
    setLaunchError(null);
    try {
      apply(await launchProject(projectId));
      setConfirmingLaunch(false);
      // The state has changed, and with it what this tab has to offer.
      setAttempt((n) => n + 1);
    } catch (cause) {
      setLaunchError(messageFor(cause, words));
    } finally {
      setLaunching(false);
    }
  }

  if (status === 'signed-out') {
    return (
      <EditorShell projectId={projectId} copy={copy} active="review">
        <InlineAlert variant="info" title={copy.signedOutTitle}>
          {copy.signedOutDetail}
        </InlineAlert>
      </EditorShell>
    );
  }

  if (status === 'failed' || checklistError !== null) {
    return (
      <EditorShell projectId={projectId} copy={copy} active="review">
        <InlineAlert variant="danger" title={words.loadFailedTitle}>
          {error ?? checklistError}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={reloadAll}>
          {copy.tryAgain}
        </Pill>
      </EditorShell>
    );
  }

  if (project === null || checklist === null) {
    return (
      <EditorShell projectId={projectId} copy={copy} active="review">
        <SkeletonGroup label={words.loadingLabel}>
          <div className="flex flex-col gap-4">
            {LOADING_ROWS.map((row) => (
              <Skeleton key={row} height="2.5rem" />
            ))}
          </div>
        </SkeletonGroup>
      </EditorShell>
    );
  }

  const progress = progressOf(checklist);
  const blockers = unmetOf(checklist.blocking);
  const suggestions = unmetOf(checklist.advisory);
  const moderation = checklist.moderation;
  const canOfferSubmit = SUBMITTABLE_FROM.includes(checklist.state);
  const canOfferLaunch = LAUNCHABLE_FROM.includes(checklist.state);
  const held = blockers.length > 0;

  return (
    <EditorShell
      projectId={projectId}
      copy={copy}
      active="review"
      title={project.title}
      state={checklist.state}
    >
      <div className="flex flex-col gap-8">
        {/*
          The moderator's note, first and prominent. §6.1 added CHANGES_REQUESTED so
          a fixable campaign could be sent back instead of rejected, and a creator
          told "changes requested" with no reason is the exact failure that state
          exists to prevent. `danger` for a refusal that is terminal, `warning` for
          one that is an invitation to fix something.
        */}
        {moderation != null && moderation.current && moderation.outcome !== 'APPROVED' && (
          <InlineAlert
            variant={moderation.outcome === 'REJECTED' ? 'danger' : 'warning'}
            title={
              moderation.outcome === 'REJECTED'
                ? words.refusedTitle
                : words.changesRequestedTitle
            }
          >
            <p className="whitespace-pre-line text-white">
              {moderation.note ?? words.noReason}
            </p>
            <p className="mt-2">
              <time dateTime={moderation.decidedAt}>{formatDate(moderation.decidedAt)}</time>
            </p>
          </InlineAlert>
        )}

        {/*
          Waiting for review is a real state a creator sits in for days, and it must
          not look like something went wrong: `info`, not `warning`, and a sentence
          that says there is nothing to do.
        */}
        {isNotedState(checklist.state) && (
          <InlineAlert variant="info" title={copy.states[checklist.state]}>
            {words.stateNote[checklist.state]}
          </InlineAlert>
        )}

        {refusal !== null && (
          <InlineAlert variant="danger" title={words.notSubmittedTitle}>
            <p>{refusal.message}</p>
            {refusal.unmet.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {refusal.unmet.map((item) => (
                  <li key={item.requirement}>
                    {item.label}: {item.detail}
                  </li>
                ))}
              </ul>
            )}
            {/*
              A plan bound, with the way out beside it. The link is offered rather than
              followed, because changing plan is one of three answers here and the other
              two — withdraw a campaign, lower the goal — are on this creator's own
              screens.
            */}
            {refusal.limit != null && (
              <p className="mt-3">
                <Link href="/pricing" className="text-white underline underline-offset-4">
                  {words.seeOtherPlans}
                </Link>
              </p>
            )}
            <Pill variant="ghost" size="sm" className="mt-3" onClick={reloadAll}>
              {words.checkAgain}
            </Pill>
          </InlineAlert>
        )}

        <section aria-labelledby="review-progress-heading">
          <h2
            id="review-progress-heading"
            className="text-[13px] font-medium tracking-[0.06em] text-white/40 uppercase"
          >
            {words.completeness}
          </h2>
          {/*
            The sentence carries the meaning; the bar is a picture of it. Announcing
            both would say the same number twice, and the counts are the half that
            answers "is what is left optional".
          */}
          <p className="mt-2 text-[15px] text-white">{describeProgress(progress, words.progressSummary)}</p>
          <ProgressBar
            aria-hidden="true"
            value={progress.score}
            size="md"
            className="mt-3"
            label={fillPlaceholders(words.progressLabel, { score: String(progress.score) })}
          />
        </section>

        <ChecklistSection


          words={words}


          tabs={copy.tabs}
          id="review-required"
          headingRef={blockingHeading}
          heading={words.requiredHeading}
          description={words.requiredDescription}
          items={checklist.blocking}
          projectId={projectId}
          tone="blocking"
        />

        <ChecklistSection


          words={words}


          tabs={copy.tabs}
          id="review-recommended"
          heading={words.recommendedHeading}
          description={words.recommendedDescription}
          items={checklist.advisory}
          projectId={projectId}
          tone="advisory"
        />

        {canOfferSubmit && (
          <section aria-labelledby="review-submit-heading" className="flex flex-col gap-3">
            <h2 id="review-submit-heading" className="sr-only">
              {words.submit}
            </h2>

            {/*
              `aria-disabled` rather than `disabled`, the same choice the section
              navigation makes: the control keeps its place in the tab order, so a
              keyboard user learns it exists and why it will not work, instead of
              never reaching it. Pressing it moves focus to the list of what is
              missing, which is the thing they were trying to find out.
            */}
            <Pill
              variant="accent"
              size="lg"
              aria-disabled={held || submitting}
              aria-describedby="review-submit-explanation"
              onClick={() => {
                if (submitting) return;
                if (held) {
                  blockingHeading.current?.focus();
                  return;
                }
                void submit();
              }}
              className={held || submitting ? 'opacity-40' : undefined}
            >
              {submitting ? words.submitting : words.submit}
            </Pill>

            <p id="review-submit-explanation" className="text-[13px] text-white/64">
              {held
                ? `${pluralise(words.locale, words.blockersRemaining, blockers.length)} ${
                    suggestions.length > 0
                      ? words.recommendedNotPartOfThis
                      : words.finishThem
                  }`
                : words.moderatorNote}
            </p>
          </section>
        )}

        {/*
          THE CAMPAIGN CANNOT GO LIVE WITHOUT THIS CONTROL.

          `POST /v1/projects/{id}/launch` has existed since #31 and nothing in this
          application called it, so a cleared campaign sat in `APPROVED` — invisible
          to every public listing, which show `LIVE` alone — and its creator had been
          told by this very panel that it goes live when they launch it. There was
          nothing to press.
        */}
        {canOfferLaunch && (
          <section aria-labelledby="review-launch-heading" className="flex flex-col gap-3">
            <h2 id="review-launch-heading" className="sr-only">
              {words.launch}
            </h2>

            {launchError !== null && (
              <InlineAlert variant="danger" title={words.notLaunchedTitle}>
                <p>{launchError}</p>
                <Pill variant="ghost" size="sm" className="mt-3" onClick={reloadAll}>
                  {words.checkAgain}
                </Pill>
              </InlineAlert>
            )}

            {/*
              ASKED INLINE RATHER THAN IN A DIALOG, AND THE REASON IS MEASURED.

              `Modal` lives behind `@ideanest/ui/motion`, and that entry point carries 116 KiB
              of animation runtime (packages/ui/src/index.ts). This route's budget had 5 KiB
              of room. A confirmation is also the last thing on this platform that should
              arrive with a spring: docs/motion-system.md §5 gives the campaign editor "none",
              and §7 puts the launch on the money side of the scale where motion reads as
              hesitation.

              What a dialog was doing here is done by the panel: the destructive action is not
              the first press, the consequences are stated before the second, and focus moves
              to the confirmation so it cannot be missed by somebody who cannot see it appear.
            */}
            {confirmingLaunch ? (
              <div
                role="group"
                aria-labelledby="review-launch-confirm-heading"
                className="rounded-2xl border border-white/8 bg-surface-2 p-5"
              >
                <h3 id="review-launch-confirm-heading" className="text-[15px] font-medium text-white">
                  {words.confirmLaunchTitle}
                </h3>
                <p className="mt-2 text-[13px] text-white/64">
                  It becomes public immediately and starts taking pledges. The funding goal and
                  the deadline are fixed on launch and cannot be edited afterwards, and a live
                  campaign cannot be taken back to a draft.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Pill
                    variant="accent"
                    // Focus follows the consequence. The reader pressed something and a
                    // question appeared; landing on its answer is what a dialog would have
                    // done for them.
                    autoFocus
                    aria-disabled={launching}
                    className={launching ? 'opacity-40' : undefined}
                    onClick={() => {
                      if (launching) return;
                      void launch();
                    }}
                  >
                    {launching ? words.launching : words.launchNow}
                  </Pill>
                  <Pill
                    variant="ghost"
                    aria-disabled={launching}
                    onClick={() => {
                      if (launching) return;
                      setConfirmingLaunch(false);
                    }}
                  >
                    {words.cancel}
                  </Pill>
                </div>
              </div>
            ) : (
              <>
                <Pill
                  variant="accent"
                  size="lg"
                  aria-describedby="review-launch-explanation"
                  onClick={() => setConfirmingLaunch(true)}
                >
                  {words.launch}
                </Pill>

                {/* Not drawn beside the confirmation, which says the same thing at the moment
                    it matters. Two copies of one warning on one screen is one of them being
                    read and the other being scrolled past. */}
                <p id="review-launch-explanation" className="text-[13px] text-white/64">
                  The campaign appears everywhere on the platform and starts taking pledges the
                  moment it launches. Its goal and its deadline freeze from that point, and a
                  live campaign cannot be taken back to a draft.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </EditorShell>
  );
}

/* -------------------------------------------------------------------------
 * One group of requirements
 * ---------------------------------------------------------------------- */

interface ChecklistSectionProps {
  words: ReviewPanelCopy;
  /** The six section names, from the frame. */
  tabs: EditorChromeCopy['tabs'];
  id: string;
  heading: string;
  description: string;
  items: readonly ChecklistItem[];
  projectId: string;
  tone: 'blocking' | 'advisory';
  headingRef?: React.Ref<HTMLHeadingElement>;
}

function ChecklistSection({
  words,
  tabs,
  id,
  heading,
  description,
  items,
  projectId,
  tone,
  headingRef,
}: ChecklistSectionProps) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={`${id}-heading`}>
      {/*
        `tabIndex={-1}` so the submit control can move focus here. It is not in the
        tab order; it is a target, which is what -1 means.
      */}
      <h2
        id={`${id}-heading`}
        ref={headingRef}
        tabIndex={-1}
        className="text-[15px] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      >
        {heading}
      </h2>
      <p className="mt-1 text-[13px] text-white/64">{description}</p>

      <ul className="mt-4 flex flex-col gap-2">
        {items.map((item) => (
          <ChecklistRow
            key={item.requirement}
            words={words}
            tabs={tabs}
            item={item}
            projectId={projectId}
            tone={tone}
          />
        ))}
      </ul>
    </section>
  );
}

function ChecklistRow({
  words,
  tabs,
  item,
  projectId,
  tone,
}: {
  words: ReviewPanelCopy;
  tabs: EditorChromeCopy['tabs'];
  item: ChecklistItem;
  projectId: string;
  tone: 'blocking' | 'advisory';
}) {
  const href = item.satisfied ? null : sectionHref(projectId, item.section);

  /*
    Three shapes, three words. The icon distinguishes the rows for somebody who
    cannot tell the colours apart, and the spoken status distinguishes them for
    somebody who cannot see either — a checklist that relied on green and red
    would be unreadable to both (docs/ui-kit.md §9.2).
  */
  const status = item.satisfied
    ? 'Done'
    : tone === 'blocking'
      ? words.requiredNotDone
      : words.recommendedNotDone;

  return (
    <li className="flex items-start gap-3 rounded-lg border border-white/8 bg-surface-2 p-3">
      {item.satisfied ? (
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
      ) : tone === 'blocking' ? (
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
      ) : (
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[15px] text-white">
          {item.label}
          <span className="sr-only">, {status}</span>
        </p>
        {!item.satisfied && item.detail != null && (
          <p className="mt-1 text-[13px] text-white/64">{item.detail}</p>
        )}
      </div>

      {href !== null && isChecklistSection(item.section) && (
        /*
          The link is what makes the row actionable. Its accessible name names the
          requirement as well as the section, because "Fix in Basics" repeated four
          times is four indistinguishable links in a screen reader's list.
        */
        <Link
          href={href}
          className="shrink-0 rounded-full bg-surface-3 px-3 py-1 text-[13px] text-white transition-colors duration-150 ease-in-out hover:bg-surface-4"
        >
          {fillPlaceholders(words.fixIn, { section: tabs[item.section] })}
          <span className="sr-only">: {item.label}</span>
        </Link>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------
 * Failures
 * ---------------------------------------------------------------------- */

function messageFor(cause: unknown, words: ReviewPanelCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 404) return words.notFound;
    /*
     * A plan refusal is a 403 and is not "you do not have access to this campaign" — it is
     * this creator's own campaign and they can edit every part of it. The server's own
     * sentence names the plan and the bound, which is what makes it actionable, so it is
     * preferred over the generic line below.
     */
    if (cause.problem?.code === 'PLAN_LIMIT_EXCEEDED') {
      return cause.problem?.detail ?? words.planDoesNotCover;
    }
    if (cause.status === 403) return words.noAccess;
    return cause.problem?.detail ?? cause.problem?.title ?? words.serviceRefused;
  }
  return words.unreachable;
}

/**
 * A refused submission, as something to render.
 *
 * `PROJECT_NOT_SUBMITTABLE` carries the requirements. `PLAN_LIMIT_EXCEEDED` carries the
 * bound that was hit. `PROJECT_TRANSITION_NOT_ALLOWED` carries none — it means the campaign is not in a state it can be submitted from,
 * which is usually another tab or a moderator having moved it, so the message is
 * the server's and the fix is to reload.
 */
function refusalFrom(cause: unknown, words: ReviewPanelCopy): Refusal {
  if (cause instanceof ApiError) {
    return {
      message: messageFor(cause, words),
      unmet: unmetFromRefusal(cause.problem?.meta),
      limit: planLimitFrom(cause),
    };
  }
  return { message: messageFor(cause, words), unmet: [] };
}

/**
 * The plan bound a refusal named, if it named one.
 *
 * <p>Read off `meta` rather than parsed out of `detail`, per §10.4: the detail is prose in
 * one language and this panel is read in four.
 */
function planLimitFrom(cause: ApiError): Refusal['limit'] {
  if (cause.problem?.code !== 'PLAN_LIMIT_EXCEEDED') return undefined;

  const meta = cause.problem?.meta as
    | { plan?: unknown; allowed?: unknown; actual?: unknown }
    | undefined;
  if (meta == null) return undefined;

  return {
    plan: typeof meta.plan === 'string' ? meta.plan : '',
    allowed: typeof meta.allowed === 'string' ? meta.allowed : '',
    actual: typeof meta.actual === 'string' ? meta.actual : '',
  };
}

function formatDate(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  return when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Whether this state is one the tab has a sentence for. The other eleven get none. */
function isNotedState(state: ProjectState): state is ReviewNotedState {
  return (
    state === 'SUBMITTED' ||
    state === 'APPROVED' ||
    state === 'SCHEDULED' ||
    state === 'REJECTED' ||
    state === 'LIVE'
  );
}
