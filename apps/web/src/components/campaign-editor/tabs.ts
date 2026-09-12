/**
 * The editor's sections, in the order a campaign is built.
 *
 * ONE LIST, and it is the only place a tab is declared. The shell renders it,
 * every tab page names itself from it, and the routes are derived from it — so
 * adding a section is a row here plus the route it points at, not a hunt through
 * the navigation markup.
 *
 * `available: false` means the route does not exist yet. It renders as a
 * disabled tab rather than as a stub page, and that is a deliberate choice
 * between two bad options:
 *
 *   A stub page lies. A creator who lands on an empty "Rewards" screen cannot
 *   tell whether the feature is broken, empty, or unbuilt, and the honest answer
 *   — "this is not finished yet" — is exactly what a disabled tab says.
 *
 *   A stub page also has to exist as a file. `apps/web/src/app/projects/[id]/
 *   edit/prelaunch/page.tsx` belongs to #39, and creating it here to be
 *   deleted there is a merge conflict in a file this issue does not own.
 *   (#34 flipped `rewards` to true and added its route the same way, which is
 *   what the `available` flag is for.)
 *
 * The tab stays focusable while disabled: a keyboard user is told the section
 * exists and is not yet available, which is more useful than a control that
 * cannot be reached at all.
 */
export type EditorTabKey = 'basics' | 'rewards' | 'story' | 'faq' | 'prelaunch' | 'review';

export interface EditorTab {
  key: EditorTabKey;
  /*
   * NO `label`. The section's name is catalogue copy, read by `EditorShell` as
   * `copy.tabs[tab.key]` — issue #324. A spelling here as well would be a second
   * one, and this file's own warning about two declarations drifting applies to
   * it first.
   */
  /** Path segment under `/projects/[id]/edit`. */
  segment: EditorTabKey;
  /** Whether the route exists. Flip it in the pull request that adds the page. */
  available: boolean;
  /** The sub-issue that builds it. Shown to nobody; it is here for the reader. */
  issue: number;
}

export const EDITOR_TABS: readonly EditorTab[] = [
  { key: 'basics', segment: 'basics', available: true, issue: 33 },
  { key: 'rewards', segment: 'rewards', available: true, issue: 34 },
  { key: 'story', segment: 'story', available: true, issue: 35 },
  /*
   * AFTER STORY, BEFORE PRE-LAUNCH, because that is when a creator writes it.
   * The questions are answered once the campaign says what it is and before it
   * is shown to anybody — and the public tab (#283) is empty until this exists,
   * so a creator who reaches Pre-launch without passing it launches with a tab
   * that tells backers the campaign has answered nothing.
   */
  { key: 'faq', segment: 'faq', available: true, issue: 283 },
  { key: 'prelaunch', segment: 'prelaunch', available: true, issue: 39 },
  { key: 'review', segment: 'review', available: true, issue: 37 },
];

export function editorTabHref(projectId: string, tab: EditorTab): string {
  return `/projects/${encodeURIComponent(projectId)}/edit/${tab.segment}`;
}
