import { Link } from '../../i18n/navigation';
import { getTranslations } from 'next-intl/server';
import { acceptsPledges } from '../../lib/projects/pledgeable';
import type { ProjectState } from '../../lib/projects/api';

/**
 * §4.4's call to action: the one control on the campaign page that leads to §4.5.
 *
 * <h2>Why this file exists at all</h2>
 *
 * The pledge flow has been complete since #54 — a route, a reservation, a quote, an
 * idempotent draft and a confirmation, with tests around each — and until this component
 * there was **no link to it anywhere in the application**. `/projects/{id}/back` was
 * reachable by typing it. On a funding platform that is not a missing button; it is the
 * product not working, and it survived review because every part of it that could be tested
 * in isolation passed.
 *
 * `CampaignRewards` has carried a comment since #281 saying a control that led there "is the
 * next thing this page wants". This is that control, and the per-tier one beside it.
 *
 * <h2>A Server Component, and a link rather than a button</h2>
 *
 * Nothing here needs the session, the clipboard or the clock — {@link acceptsPledges} is a
 * function of values the server already has. So this renders in the HTML a crawler and a
 * reader with no JavaScript are served, and it costs the campaign route no First Load JS,
 * which is the whole argument `CampaignSummary` makes about its three client islands.
 *
 * It is an `<a>` because it navigates. A `<button>` that pushed a route would take the
 * middle-click, the long-press and the "open in new tab" away from the one action this page
 * exists to offer, and would be announced to a screen reader as the wrong kind of control.
 *
 * <h2>Colour: white, and the page keeps its single lime element</h2>
 *
 * docs/ui-kit.md §2.5 maps `--white-surface` to "primary pill" and says *when white*: "the
 * element ... is the primary action". §7.2 draws the same control as `.pill--primary`. That
 * is what this is.
 *
 * The alternative reading is §8.1's "selected reward tier → `--lime-500`" and §8.5's lime
 * confirm button, and both are about a screen this one leads to rather than this one. §2.5
 * settles it outright: white and lime "should not appear on the same card ... one says 'this
 * matters'; the other says 'this is happening now'. Together they say neither." A campaign
 * closing within 48 hours already draws a lime pill three elements above this, and §7.2 caps
 * the screen at one accent pill. So the urgency badge keeps lime, this takes white, and the
 * two say different things instead of competing.
 *
 * <h2>Nothing at all when the campaign is closed</h2>
 *
 * Not a disabled control, and not an explanation. Nine states render this page and only two
 * of them take pledges; the other seven already say what they are — a state badge at the top
 * of the header, and `CampaignOutcome` under the figures for a campaign that has finished.
 * A greyed-out "Back this campaign" beneath them would add a third statement of the same
 * fact, phrased as a thing the reader failed to do.
 */
export interface BackCampaignCtaProps {
  /** The campaign's identifier — the `[id]` segment `/projects/{id}/back` is reached by. */
  readonly projectId: string;
  readonly state: ProjectState;
  /** ISO 8601, or `null` on a campaign with no funding window. */
  readonly deadline: string | null;
  /**
   * The instant the deadline is measured against, threaded from the page so that this
   * control, the countdown and the structured data cannot come to three answers about
   * whether a campaign is still open.
   */
  readonly now: Date;
}

export async function BackCampaignCta({ projectId, state, deadline, now }: BackCampaignCtaProps) {
  if (!acceptsPledges(state, deadline, now)) return null;

  const t = await getTranslations('campaign.back');

  // One offer in every state that takes pledges: IDN-EXT-01 (#36) switched late pledges off,
  // so the seven-day window and an extension are the same funding as the campaign itself.
  const label = t('cta');

  return (
    <Link
      href={`/projects/${encodeURIComponent(projectId)}/back`}
      className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-base font-medium text-on-white transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]"
    >
      {label}
    </Link>
  );
}
