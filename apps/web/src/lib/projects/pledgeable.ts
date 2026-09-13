import type { ProjectState } from './api';

/**
 * Whether a campaign can be backed right now — the question every entry point to §4.5 asks.
 *
 * <h2>Why this is a module and not two lines in a component</h2>
 *
 * Three surfaces ask it, and they must give the same answer or the page contradicts itself:
 * the "Back this campaign" control in `CampaignSummary`, the per-tier control in
 * `CampaignRewards`, and `structured-data/product.ts`, which decides whether a crawler is
 * told the rewards are on offer. A campaign whose tiers carry an `Offer` in the markup and
 * no way to take it is the same defect in two directions — one lies to a search engine, the
 * other lies to a reader.
 *
 * The state list already existed inside `structured-data/product.ts`, which is why that file
 * now imports it from here rather than declaring its own. Two lists would drift the first
 * time §6.1 gains a state, and the half that drifted would be the one nobody reads.
 *
 * <h2>This answers a narrower question than "is this page public"</h2>
 *
 * `RENDERABLE_STATES` in `publicPage.ts` is nine states long: a `SUCCESSFUL` campaign is
 * public, indexable, and closed. Its rewards are still printed, and they are still not for
 * sale. Backing is three of the public states — IDN-EXT-01 (#36).
 *
 * <h2>It is a prediction, not a permission</h2>
 *
 * The service decides — `project.application.PledgeAcceptance` is the only authority, and it
 * reads rows this client cannot see. What this does is keep the interface from OFFERING an
 * action the service is certain to refuse, which is the difference between a campaign that
 * closed and a button that is broken. Where the two can disagree the answer here is
 * deliberately the more permissive one, because the checkout reports a refusal properly and
 * a hidden control reports nothing at all:
 *
 * <ul>
 *   <li>an `EXTENDED` campaign whose extension ended this minute, or a `CLOSING_WINDOW` one
 *       whose seven days did. Neither end is on the public projection, so this cannot be
 *       known here;</li>
 *   <li>a campaign suspended in the second between this render and the click.</li>
 * </ul>
 *
 * Both end at the checkout's `PROJECT_NOT_ACCEPTING_PLEDGES`, which `lib/pledges/failure.ts`
 * turns into a sentence. The opposite mistake — hiding the control from a campaign that is
 * taking pledges — has no such recovery, because there is nothing on screen to click.
 */
export const PLEDGEABLE_PROJECT_STATES: readonly string[] = Object.freeze([
  'LIVE',
  'CLOSING_WINDOW',
  'EXTENDED',
]);

/**
 * Whether to offer the pledge flow for a campaign in this state at this instant.
 *
 * <p><strong>The deadline is checked as well as the state</strong>, and only for `LIVE`.
 * §8.4's finalizer runs every minute, so for up to a minute a campaign whose funding window
 * closed is still `LIVE` in the table — `PledgeAcceptance` refuses it, in a comment calling
 * that "the difference between a deadline and a suggestion". A control offered in that minute
 * would send a backer to a checkout that cannot take their pledge.
 *
 * <p>A `CLOSING_WINDOW` or `EXTENDED` campaign is past its first deadline by definition —
 * IDN-EXT-01 (#36) keeps taking pledges in both — so the same check would refuse exactly the
 * pledges those states exist for. There are no late pledges any more.
 *
 * @param state the campaign's state, as the public projection reports it
 * @param deadline the funding deadline as an ISO instant, or `null` when there is none
 * @param now the instant to measure against. Injected rather than read, so a test can ask
 *     what the page looks like ninety seconds after a campaign closed
 */
export function acceptsPledges(
  state: ProjectState,
  deadline: string | null,
  now: Date,
): boolean {
  if (!PLEDGEABLE_PROJECT_STATES.includes(state)) return false;
  if (state !== 'LIVE') return true;
  if (deadline === null || deadline === '') return true;

  const closesAt = new Date(deadline);
  /*
   * An unparseable deadline is treated as absent rather than as closed. The alternative
   * hides the primary action on a live campaign because a string was malformed, which is a
   * silent outage of the one thing this page is for; the checkout still refuses it if the
   * service disagrees.
   */
  if (Number.isNaN(closesAt.getTime())) return true;

  return closesAt.getTime() > now.getTime();
}
