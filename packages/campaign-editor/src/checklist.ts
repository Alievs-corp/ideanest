import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { ChecklistItem, ProjectChecklist, ProjectState } from './contract';
import type { ReviewNotedState } from './copy';

/**
 * The review tab, as data: how far along a campaign is, where each failing
 * requirement is fixed, and what a server-side refusal is saying.
 *
 * Kept out of the component for the reason `basics.ts` gives — these are edges
 * with exact answers, and rules that live inside a form are rules nobody can test
 * at the boundaries.
 *
 * NOTHING HERE DECIDES WHETHER A CAMPAIGN MAY BE SUBMITTED. The server does, with
 * the same class that produces this response, and `POST /submit` re-checks it. The
 * functions below shape what the service already said; there is deliberately no
 * client-side copy of §5.3 to fall out of step with it — which is the difference
 * between this file and `basics.ts`, where the client validates for immediate
 * feedback while somebody types.
 */

/**
 * The editor sections a requirement can point at.
 *
 * The same strings as `EDITOR_TABS[].segment`, because the server sends the route
 * segment and the client builds a link out of it. `checklist.test.ts` asserts the
 * two lists agree, so a tab renamed in one place fails rather than producing links
 * that resolve to nothing.
 */
export const CHECKLIST_SECTIONS = ['basics', 'rewards', 'story'] as const;

export type ChecklistSectionKey = (typeof CHECKLIST_SECTIONS)[number];

/**
 * Whether this build knows where to send somebody for this requirement.
 *
 * A section this build does not recognise means the service is ahead of the
 * client. The item is still shown — it is still a real requirement — but without
 * a link, because a link to a route that does not exist is worse than none.
 */
export function isChecklistSection(value: string): value is ChecklistSectionKey {
  return (CHECKLIST_SECTIONS as readonly string[]).includes(value);
}

/** Where a failing requirement is fixed, or `null` when this build cannot tell. */
export function sectionHref(projectId: string, section: string): string | null {
  if (!isChecklistSection(section)) return null;
  // Mirrors `editorTabHref` in `./tabs`. Written out rather than imported so that
  // the two lists stay independent; the test holds them together. A web address:
  // the app maps the same segment onto its own route.
  return `/projects/${encodeURIComponent(projectId)}/edit/${section}`;
}

/*
 * NO `SECTION_LABEL` — issue #8. The three sections are named by the editor's own tabs, read
 * as `copy.tabs[section]`, so "Fix in Rewards" and the Rewards tab cannot end up spelled
 * differently. `tabs.ts` gave up its labels for the same reason.
 */

/* -------------------------------------------------------------------------
 * What the review tab offers
 * ---------------------------------------------------------------------- */

/**
 * The states from which submitting is an action worth offering.
 *
 * A PRESENTATION DECISION, NOT A RULE. §6.1 is enforced server-side and there is
 * deliberately no client-side transition table; this only decides whether to draw
 * a button, because "Submit for review" under a live campaign is nonsense rather
 * than a refusal worth letting somebody discover. Anything this list is wrong
 * about becomes a 409 the panel renders, which is the same outcome as never having
 * had the list. Shared so that the web and the app (#162) draw the button in the
 * same states.
 */
export const SUBMITTABLE_FROM: readonly ProjectState[] = ['DRAFT', 'PRELAUNCH', 'CHANGES_REQUESTED'];

/**
 * The states from which launching is an action worth offering.
 *
 * The same presentation decision {@link SUBMITTABLE_FROM} is, and §6.1's own pair:
 * a moderator clears a campaign into `APPROVED`, and `SCHEDULED` is that campaign
 * waiting for a time it may still be taken past. Everything else the server
 * refuses, and the refusal is rendered.
 */
export const LAUNCHABLE_FROM: readonly ProjectState[] = ['APPROVED', 'SCHEDULED'];

export function offersSubmit(state: ProjectState): boolean {
  return SUBMITTABLE_FROM.includes(state);
}

export function offersLaunch(state: ProjectState): boolean {
  return LAUNCHABLE_FROM.includes(state);
}

/** Whether this state is one the review tab has a sentence for. The other eleven get none. */
export function isReviewNotedState(state: ProjectState): state is ReviewNotedState {
  return (
    state === 'SUBMITTED' ||
    state === 'APPROVED' ||
    state === 'SCHEDULED' ||
    state === 'REJECTED' ||
    state === 'LIVE'
  );
}

/* -------------------------------------------------------------------------
 * Progress
 * ---------------------------------------------------------------------- */

export interface ChecklistProgress {
  /** The server's score, 0–100. Never recomputed here; the weighting is its rule. */
  score: number;
  blockingDone: number;
  blockingTotal: number;
  advisoryDone: number;
  advisoryTotal: number;
}

export function progressOf(checklist: ProjectChecklist): ChecklistProgress {
  return {
    score: checklist.score,
    blockingDone: checklist.blocking.filter((item) => item.satisfied).length,
    blockingTotal: checklist.blocking.length,
    advisoryDone: checklist.advisory.filter((item) => item.satisfied).length,
    advisoryTotal: checklist.advisory.length,
  };
}

/**
 * The score as a sentence.
 *
 * A PERCENTAGE IS NOT A PROGRESS BAR. A bar is a picture of a number, and a
 * screen-reader user gets nothing from `role="progressbar"` that this does not say
 * better: the counts are what tell somebody how much work is left, and "10 of 10
 * required" answers the question the bar cannot — whether the remainder is
 * optional.
 */
export function describeProgress(progress: ChecklistProgress, template: string): string {
  return fillPlaceholders(template, {
    score: String(progress.score),
    blockingDone: String(progress.blockingDone),
    blockingTotal: String(progress.blockingTotal),
    advisoryDone: String(progress.advisoryDone),
    advisoryTotal: String(progress.advisoryTotal),
  });
}

export function unmetOf(items: readonly ChecklistItem[]): readonly ChecklistItem[] {
  return items.filter((item) => !item.satisfied);
}

/* -------------------------------------------------------------------------
 * Reading a refusal
 * ---------------------------------------------------------------------- */

/** One requirement named by a `PROJECT_NOT_SUBMITTABLE` problem detail. */
export interface UnmetRequirement {
  requirement: string;
  label: string;
  section: string;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequirement(value: unknown): UnmetRequirement | null {
  if (!isRecord(value)) return null;
  const { requirement, label, section, detail } = value;
  if (typeof requirement !== 'string' || typeof label !== 'string') return null;
  if (typeof section !== 'string' || typeof detail !== 'string') return null;
  return { requirement, label, section, detail };
}

/**
 * The requirements a refused submission named, out of `meta.unmet`.
 *
 * WHY THE SERVER'S LIST REPLACES THE CLIENT'S. The checklist this panel is
 * showing was read when the tab opened. A collaborator may have emptied a field
 * since, or the deployment may enforce a rule this build does not know about — and
 * in both cases the server has just said which requirements refused the
 * submission. Showing the stale list beside a refusal would leave the creator
 * looking at a screen that says everything is fine.
 *
 * Narrowed rather than cast. `meta` is `unknown` by declaration and this is the
 * boundary; an entry that is not the shape above is dropped rather than rendered
 * as `undefined`.
 */
export function unmetFromRefusal(meta: Record<string, unknown> | undefined): UnmetRequirement[] {
  const unmet = meta?.unmet;
  if (!Array.isArray(unmet)) return [];

  const requirements: UnmetRequirement[] = [];
  for (const entry of unmet) {
    const requirement = readRequirement(entry);
    if (requirement !== null) requirements.push(requirement);
  }
  return requirements;
}
