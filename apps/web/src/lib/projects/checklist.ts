import type { ChecklistItem, ProjectChecklist } from './api';

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

import { fillPlaceholders } from '../i18n/placeholders';

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
  // Mirrors `editorTabHref`. Written out rather than imported so that this module
  // stays free of the component layer; the test holds the two together.
  return `/projects/${encodeURIComponent(projectId)}/edit/${section}`;
}

/*
 * NO `SECTION_LABEL` — issue #8. The three sections are named by the editor's own tabs, read
 * as `copy.tabs[section]`, so "Fix in Rewards" and the Rewards tab cannot end up spelled
 * differently. `tabs.ts` gave up its labels for the same reason.
 */

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
