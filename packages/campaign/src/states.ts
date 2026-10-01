/**
 * The campaign states, and which of them have a public campaign page.
 *
 * <h2>Why the state type lives here</h2>
 *
 * The published contract types `state` as a bare `string` — springdoc cannot see the Java enum
 * behind it — so the vocabulary has always been written down by hand on the client. It was
 * `apps/web/src/lib/projects/api.ts`; it moved here with the campaign page's logic (#155) so
 * the app's campaign screen reads the same nineteen words, and the web module re-exports it so
 * none of its callers changed. CLAUDE.md §3: a type shared between packages lives in a shared
 * package and is never duplicated.
 */

/**
 * Exactly the nineteen states of docs/architecture.md §6.1, no more. IDN-EXT-01 added
 * `CLOSING_WINDOW`, `EXTENDED` and `WITHDRAWN` (#32); `COLLECTING` and `LATE_PLEDGE` stay
 * until stage 4 removes them (#45).
 *
 * The clients only ever render these; the transitions themselves are the server's business
 * and there is deliberately no client-side copy of the transition table to fall out of step
 * with it.
 */
export type ProjectState =
  | 'DRAFT'
  | 'PRELAUNCH'
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'LIVE'
  | 'CLOSING_WINDOW'
  | 'EXTENDED'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'SUCCESSFUL'
  | 'UNSUCCESSFUL'
  | 'WITHDRAWN'
  | 'COLLECTING'
  | 'LATE_PLEDGE'
  | 'FULFILLING'
  | 'COMPLETED';

/**
 * The states that have a campaign page — `PublicProjects.VISIBLE`, restated.
 *
 * <strong>This is deliberately NOT the web's `isPubliclyVisible`, and the difference is not a
 * mistake in either of them.</strong> They answer two different questions and disagree
 * about exactly two states:
 *
 * <ul>
 *   <li><strong>`CANCELED` has a page and must not be described.</strong> Backers
 *       committed money to it and are owed the page that explains what happened;
 *       `isPubliclyVisible` refuses it because a social card is a presentation of a
 *       campaign to back, and this is not one.
 *   <li><strong>`SCHEDULED` is described and has no page here.</strong> Its public surface
 *       is the pre-launch route, which the service serves from a different endpoint; the
 *       campaign page 404s for it, because there is no campaign yet.
 * </ul>
 *
 * Two independent statements of one rule, checked against each other in a test, is the
 * arrangement the service already uses for the same list — `PublicProjects` and
 * `DiscoveryStatus` each write the list down rather than deriving one from the other. The
 * alternative here is no statement at all, which would mean trusting a single service-side
 * check to be the only thing standing between a draft and a screen.
 *
 * <p>Both clients ask it: the web turns a state outside it into a 404, and the app into its
 * not-found screen, distinct from a network failure (#155).
 */
export const RENDERABLE_STATES: readonly ProjectState[] = [
  'PRELAUNCH',
  'LIVE',
  'CANCELED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
  // IDN-EXT-01 (#32): public like their siblings — two still take pledges, and a withdrawn
  // campaign is a successful one that owes its backers every reward.
  'CLOSING_WINDOW',
  'EXTENDED',
  'WITHDRAWN',
];

/** Whether a campaign in this state has a page. A state this build does not know has none. */
export function isRenderableState(state: string): state is ProjectState {
  return (RENDERABLE_STATES as readonly string[]).includes(state);
}
