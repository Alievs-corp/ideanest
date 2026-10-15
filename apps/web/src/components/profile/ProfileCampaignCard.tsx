import Decimal from 'decimal.js';
import Image from 'next/image';
import { Link } from '../../i18n/navigation';
import { CalendarClock, CircleCheck, CircleDot, CircleSlash, Package, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { MediaFrame, ProgressBar, Tag } from '@ideanest/ui/server';
import { canOptimise } from '../../lib/images/source';
import { PROFILE_CARD_SIZES } from '../../lib/images/sizes';
import { formatMoney } from '../../lib/money';
import { profileCampaignHref, type ProfileProjectCard } from '../../lib/profiles/api';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import type { ProfileCardCopy } from '../../lib/i18n/profile-copy';

/**
 * One campaign on a profile — §4.2 P-04 and P-05, issue #274.
 *
 * <h2>READ THIS BEFORE ADDING A NUMBER TO THE BACKED LIST</h2>
 *
 * **§4.2's P-04 is "Backed projects archive (no amounts)", and it means no amounts at all.**
 * Not the amount this person pledged, and not the amount the campaign has raised. The
 * `funding="withheld"` branch below renders neither, and the service does not send them, so
 * there is nothing here to un-hide.
 *
 * The rule is easy to mistake for an oversight, which is why it is written down twice. It is
 * not about the size of somebody's pledge being secret from them — they can read it on their
 * own pledge page. It is that a public, permanent, paginated list of the campaigns a named
 * person funded, **with the money beside each one**, is a financial profile of them that they
 * never agreed to publish. The list of campaigns is a statement of interest; the list of
 * campaigns with figures is a statement of means. §4.5's PL-12 makes the same distinction
 * from the other end by keeping anonymous pledges off the list entirely.
 *
 * A reader who wants a campaign's funding total is one click away from the campaign, where it
 * is published by the creator about their own campaign. That is where it belongs.
 *
 * <h2>The created list does show money, and that is not inconsistent</h2>
 *
 * A creator's own campaigns publish their goal and their total on every surface the platform
 * has — the discovery card, the campaign page, the search result. Withholding them on the
 * creator's own profile would hide a public figure from the one page that exists to
 * summarise it.
 *
 * <h2>Money is never a JavaScript number</h2>
 *
 * `goal` and `pledged` arrive as decimal strings and are read with `decimal.js` (CLAUDE.md
 * §3). The only number in this file is the width of the progress track, which is a geometry
 * in pixels rather than an amount anybody is owed — the same line `components/discovery/ProjectCard`
 * draws.
 *
 * <h2>Colour never carries the meaning</h2>
 *
 * Every status is a hue **and** an icon **and** a word (docs/ui-kit.md §9.2), and the
 * completion figure is printed as text beside the bar rather than left to the fill. There is
 * no lime anywhere on this card: nothing on a profile is urgent, and a profile is not a feed
 * with one card in it that is about to close (§8.1, §8.2).
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §8 forbids animation in long lists outright, and a profile's created
 * list is unbounded downward in exactly the way a feed is. The cover's box is reserved by
 * `MediaFrame` before the bytes arrive, so a grid of twelve does not reflow as they decode.
 */

/**
 * The publicly listed states of §6.1, as words, each with an icon.
 *
 * A `Record<string, …>` rather than a `Record<ProjectState, …>` because the wire type is
 * widened (`lib/profiles/api.ts` says why): a state a newer service returns renders as
 * itself rather than as an empty tag or a crash.
 */
const STATE: Record<string, { readonly icon: ReactNode; readonly variant: 'default' | 'success' | 'warning' }> = {
  PRELAUNCH: { icon: <CalendarClock className="size-2.5 lg:size-3" />, variant: 'default' },
  SCHEDULED: { icon: <CalendarClock className="size-2.5 lg:size-3" />, variant: 'default' },
  LIVE: { icon: <CircleDot className="size-2.5 lg:size-3" />, variant: 'default' },
  SUCCESSFUL: { icon: <CircleCheck className="size-2.5 lg:size-3" />, variant: 'success' },
  UNSUCCESSFUL: { icon: <CircleSlash className="size-2.5 lg:size-3" />, variant: 'default' },
  FULFILLING: { icon: <Package className="size-2.5 lg:size-3" />, variant: 'default' },
  COMPLETED: { icon: <CircleCheck className="size-2.5 lg:size-3" />, variant: 'success' },
};

/** The state tag, one rung down from `Tag`'s 26px / 12px with the rest of the card (#368). */
const CARD_TAG = 'h-5.5 gap-1 px-2 text-[11px] lg:h-6 lg:px-2.5 lg:text-xs';


/**
 * The completion figure, as a decimal.
 *
 * Absent when there is no goal, when there is no pledged total, and when the goal is zero.
 * A percentage of nothing is undefined rather than zero, and printing "0% funded" over a
 * campaign that has not opened tells a reader it failed to raise a goal it never set.
 */
function completionOf(goal: string, pledged: string): Decimal | null {
  try {
    const target = new Decimal(goal);
    if (target.lessThanOrEqualTo(0)) return null;
    return new Decimal(pledged).dividedBy(target).times(100);
  } catch {
    // A malformed figure is a card without a progress bar, not a crash.
    return null;
  }
}

export interface ProfileCampaignCardProps {
  readonly card: ProfileProjectCard;
  /**
   * Whether the funding figures may be printed.
   *
   * **`'withheld'` on the backed list, always.** It is a required prop rather than a default
   * so that a new caller has to decide, in writing, which list it is rendering — a default of
   * `'shown'` would make the P-04 breach the thing that happens when somebody forgets.
   */
  readonly funding: 'shown' | 'withheld';
  /** Loads the cover eagerly. True only for the cards above the fold. */
  readonly priority?: boolean;
  /** The card's words, resolved by the route — see `lib/i18n/profile-copy.ts`. */
  readonly copy: ProfileCardCopy;
  /**
   * The language, for the backer count alone — issue #324.
   *
   * The count is the one number on this card that changes its sentence: Russian picks between
   * three forms by the last digit. Everything else here is either the campaign's own words or a
   * figure `lib/money.ts` formats against the campaign's currency, which is a property of the
   * project and never of the reader.
   */
  readonly locale: Locale;
}

export function ProfileCampaignCard({
  card,
  funding,
  priority = false,
  copy,
  locale,
}: ProfileCampaignCardProps) {
  const badge = STATE[card.state];
  const stateLabel = copy.states[card.state];

  const goal = card.goal ?? null;
  const pledged = card.pledged ?? null;
  const completion =
    funding === 'shown' && goal !== null && pledged !== null
      ? completionOf(goal.amount, pledged.amount)
      : null;
  // Rounded down, as the discovery card and the campaign page round: 99.5% is not "100%".
  const percent = completion?.toFixed(0, Decimal.ROUND_DOWN) ?? '';

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-lg border border-white/8 bg-surface-2 transition-colors duration-300 ease-in-out hover:bg-surface-3">
      {/*
        The box is reserved whether or not there is a cover, so a campaign with a photograph
        and one without are the same height and the grid below never moves (docs/ui-kit.md
        §7.16). `alt` is empty by decision: the title is the next element and it is the link.
      */}
      <MediaFrame ratio="16/9">
        {card.coverImage !== null && (
          <Image
            src={card.coverImage.url}
            alt=""
            fill
            sizes={PROFILE_CARD_SIZES}
            /* A host the optimiser will not fetch is served as it is rather than thrown
               over — one creator's typo must not blank the whole grid. */
            unoptimized={!canOptimise(card.coverImage.url)}
            priority={priority}
            className="object-cover"
          />
        )}
      </MediaFrame>

      {/*
        ONE RUNG DOWN, THROUGHOUT (#368), as on `ProjectCard`: the card is 85% of the width it
        was, so the title is 16px, the blurb and figures 12px, the tag and meta 11px — the
        floor docs/ui-kit.md §5.2 allows — and padding, gaps and icons one Tailwind step each.
      */}
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        {badge !== undefined && stateLabel !== undefined ? (
          <div>
            <Tag variant={badge.variant} className={CARD_TAG}>
              <span aria-hidden="true" className="flex items-center">
                {badge.icon}
              </span>
              {stateLabel}
            </Tag>
          </div>
        ) : (
          <div>
            {/* A state a newer service returns renders as itself rather than as an empty tag. */}
            <Tag className={CARD_TAG}>{card.state}</Tag>
          </div>
        )}

        <h3 className="text-base lg:text-lg font-medium tracking-[-0.02em] break-words text-white">
          {/* One link for the whole card: one tab stop and one announcement per campaign,
              with the pointer target still the size of the card. */}
          <Link
            href={profileCampaignHref(card)}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {card.title}
          </Link>
        </h3>

        {card.blurb !== null && card.blurb !== '' && (
          <p className="line-clamp-2 text-xs lg:text-sm text-white/64">{card.blurb}</p>
        )}

        {funding === 'shown' && completion !== null && pledged !== null ? (
          <div className="mt-auto flex flex-col gap-1.5 pt-1.5">
            <ProgressBar
              className="h-1.25"
              /* A width, not an amount. The figure a reader acts on is the text below it,
                 which comes from the decimal. */
              value={completion.toNumber()}
              label={fillPlaceholders(copy.progressLabel, { percent })}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1 text-xs lg:text-sm">
              <span className="font-medium tabular-nums text-white">{formatMoney(pledged)}</span>
              <span className="tabular-nums text-white/64">
                {fillPlaceholders(copy.funded, { percent })}
              </span>
            </div>
            {goal !== null && (
              <p className="text-[11px] lg:text-xs tabular-nums text-white/40">
                {fillPlaceholders(copy.ofGoal, { amount: formatMoney(goal) })}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-auto pt-1.5" />
        )}

        {/*
          THE BACKER COUNT IS NOT AN AMOUNT. P-04 withholds money; how many people backed a
          campaign is published on the campaign's own page for everybody, is not a figure
          about the person whose profile this is, and is what makes the row legible as a
          campaign rather than as a title on its own.
        */}
        <div className="flex items-center gap-3.5 text-[11px] lg:text-xs text-white/40">
          <span className="inline-flex items-center gap-1">
            <Users aria-hidden="true" className="size-3 lg:size-3.5" />
            <span className="tabular-nums">
              {pluralise(locale, copy.backers, card.backersCount)}
            </span>
          </span>
        </div>
      </div>
    </article>
  );
}
