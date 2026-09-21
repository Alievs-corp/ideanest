import { CalendarClock, CalendarPlus, CircleCheck, CircleDot, CircleSlash, Clock, Hourglass } from 'lucide-react';
import { Link } from '../../i18n/navigation';
import type { ReactNode } from 'react';
import { Tag } from '@ideanest/ui/server';
import { formatMoney } from '../../lib/money';
import { countdownLabel, remainingUntil } from '../../lib/projects/deadline';
import type { CampaignPage } from '../../lib/projects/publicPage';
import type { ProjectState } from '../../lib/projects/api';
import { BackCampaignCta } from './BackCampaignCta';
import { CampaignActions } from './CampaignActions';
import { CampaignMedia } from './CampaignMedia';
import { LiveFunding } from './LiveFunding';
import { CampaignCountdown } from './ViewerClock';
import { getTranslations } from 'next-intl/server';
import { fillNodes } from '../../lib/i18n/placeholders';
import { campaignActionsCopy, liveFundingCopy } from '../../lib/i18n/shell-copy.server';

/**
 * §4.4's header: the cover, the title, who made it, and how the funding stands.
 *
 * <h2>A Server Component, and that is the point of the file</h2>
 *
 * #119's complaint is that the campaign page assembled itself in the browser, so the
 * title, the summary, the creator's name and the funding figures were absent from the
 * HTML a crawler and a link unfurler are served. This component itself is a Server
 * Component and nothing here fetches: every value is read from a projection the server
 * already has.
 *
 * <strong>Three islands hang beneath it, and each one is a fact the server does not have
 * rather than content it declined to render.</strong> `LiveFunding` starts from the
 * server's figures and adds §12.1's deltas. `CampaignCountdown` needs the current time,
 * which is stale the moment a cached page is sent. `CampaignActions` needs the session and
 * the clipboard. Every one of them renders the server's answer first, so the complete
 * document is still what a crawler and a reader with no JavaScript are served; each file
 * argues its own boundary, and #281 added the last two.
 *
 * <h2>Colour</h2>
 *
 * **Lime is urgency and nothing else** (docs/ui-kit.md §2.4, §8.1). A campaign closing
 * within 48 hours gets a lime pill with near-black text; a campaign that funded gets
 * `--success`, on the progress bar and on the word beside it. The two are one token apart
 * and opposite in meaning — a backer who reads lime as "done" has been told the reverse.
 *
 * **Colour never carries meaning alone** (§9.2). Every badge here is a hue plus an icon
 * plus a word, and the completion figure is printed as text as well as drawn as a bar,
 * because a bar that only changes colour has said nothing to a screen reader.
 *
 * <h2>Motion</h2>
 *
 * None, and there is none on the page above it either — `page.tsx` sets out why the route
 * declines its moderate budget (docs/motion-system.md §5) rather than paying 116 kB of
 * animation runtime to fade one heading in. A header that animated its funding figures would
 * animate the number a backer is trying to read, and §6's rule for countdowns says the same
 * of the one added by #281: it is a number that changes, not a number that moves.
 */

/** Under two days left, which is what ui-kit §8.1 calls "closing within 48 hours". */
const URGENT_DAYS = 2;

interface StateBadge {
  /**
   * A key into `campaign.state`, not a word.
   *
   * `COLLECTING` deliberately shares `SUCCESSFUL`'s key rather than having one of its own:
   * it is an internal fact about where §6.1 has got to, and what a visitor needs to know is
   * that the campaign funded. The comment above explains the rest of the mapping.
   */
  readonly labelKey: string;
  readonly icon: ReactNode;
  readonly variant: 'default' | 'success' | 'warning' | 'danger';
}

/**
 * The twelve public states, as a word a reader recognises.
 *
 * Deliberately not the raw state name. `COLLECTING` and `FULFILLING` are internal facts
 * about where a campaign is in §6.1; what a visitor needs to know is that it funded and
 * the money is being taken. `CANCELED` is its own word rather than "unsuccessful", because
 * a campaign somebody stopped and a campaign that missed its goal are different things and
 * the backers of each were told different things.
 *
 * IDN-EXT-01 (#44) adds three. `CLOSING_WINDOW` is the week after the first deadline, when the
 * campaign still takes pledges and the catalogue badges it "Closing soon" (#37) — the same word
 * here, so a card and the page it opens agree. `EXTENDED` is the one extension. `WITHDRAWN` is a
 * campaign whose creator has taken the money: to a backer it funded, and it shares
 * `SUCCESSFUL`'s word for `COLLECTING`'s reason. Each key is its own in the catalogue so a
 * translator can tell them apart.
 */
const BADGES: Partial<Record<ProjectState, StateBadge>> = {
  PRELAUNCH: { labelKey: 'PRELAUNCH', icon: <CalendarClock className="size-3.5" />, variant: 'default' },
  LIVE: { labelKey: 'LIVE', icon: <CircleDot className="size-3.5" />, variant: 'default' },
  SUCCESSFUL: { labelKey: 'SUCCESSFUL', icon: <CircleCheck className="size-3.5" />, variant: 'success' },
  COLLECTING: { labelKey: 'SUCCESSFUL', icon: <CircleCheck className="size-3.5" />, variant: 'success' },
  LATE_PLEDGE: { labelKey: 'LATE_PLEDGE', icon: <Hourglass className="size-3.5" />, variant: 'warning' },
  FULFILLING: { labelKey: 'FULFILLING', icon: <Hourglass className="size-3.5" />, variant: 'success' },
  COMPLETED: { labelKey: 'COMPLETED', icon: <CircleCheck className="size-3.5" />, variant: 'success' },
  UNSUCCESSFUL: { labelKey: 'UNSUCCESSFUL', icon: <CircleSlash className="size-3.5" />, variant: 'default' },
  CANCELED: { labelKey: 'CANCELED', icon: <CircleSlash className="size-3.5" />, variant: 'default' },
  CLOSING_WINDOW: { labelKey: 'CLOSING_WINDOW', icon: <Hourglass className="size-3.5" />, variant: 'warning' },
  EXTENDED: { labelKey: 'EXTENDED', icon: <CalendarPlus className="size-3.5" />, variant: 'default' },
  WITHDRAWN: { labelKey: 'WITHDRAWN', icon: <CircleCheck className="size-3.5" />, variant: 'success' },
};

/*
 * ICU PLURALS RATHER THAN A TERNARY. "1 day left" against "2 days left" is the whole of
 * English and none of Russian, which chooses between three forms by the last digit — 1 день,
 * 2 дня, 5 дней — so a singular/plural split would be wrong for most numbers with nothing on
 * screen to say so. `=0` is its own case in every language because "0 days left" is not what
 * the last day of a campaign is called.
 */

export interface CampaignSummaryProps {
  readonly campaign: CampaignPage;
  /**
   * Where the browser may open §12.1's socket, or undefined for none — the default.
   *
   * Threaded from the page rather than read here, because this is a Server Component and the
   * value belongs to the client island below it. `lib/realtime/updates.ts` explains why the
   * feature is opt-in at all: a WebSocket cannot use the `/v1` rewrite this application relies
   * on, so a live counter needs an address the browser can reach directly.
   */
  readonly realtimeOrigin?: string | undefined;
  /**
   * §10.2's canonical path for this campaign.
   *
   * Threaded from the page rather than rebuilt here, for the reason `campaignTabHref` gives:
   * `page.tsx` owns `pathOf`, the canonical URL and the structured data are built from it, and
   * a second encoding of the same two slugs is a second chance for them to disagree about a
   * handle with a character that needs escaping. The share control shares it, and every
   * sign-in link under this header returns to it.
   */
  readonly path: string;
  /**
   * The instant the countdown is measured against. Defaults to the real clock.
   *
   * Injected for the same reason `readCampaignPage` takes one: a test has to be able to ask
   * what this header looks like on the last afternoon of a campaign without waiting for that
   * afternoon. Nothing in the application passes it.
   */
  readonly now?: Date;
}

export async function CampaignSummary({
  campaign,
  realtimeOrigin,
  path,
  now = new Date(),
}: CampaignSummaryProps) {
  const t = await getTranslations('campaign');
  const common = await getTranslations('common');
  const actions = await campaignActionsCopy();
  const funding = await liveFundingCopy();
  const badge = BADGES[campaign.state];

  /*
   * A COUNTDOWN ONLY WHILE THERE IS SOMETHING TO COUNT DOWN TO. `daysLeft` is floored at
   * zero, so a campaign that closed a fortnight ago reports the same number as one closing
   * tonight; "Last day" on the former is a lie, and lime would make it a loud one.
   */
  const showDays = campaign.daysLeft !== null && campaign.state === 'LIVE';
  const urgent = showDays && campaign.daysLeft !== null && campaign.daysLeft <= URGENT_DAYS;

  /*
   * §4.4'S LIVE COUNTDOWN, COMPUTED HERE AND CORRECTED IN THE BROWSER.
   *
   * The value below is what goes into the HTML, so a reader with no JavaScript and a crawler
   * both get a real number rather than an empty element. `CampaignCountdown` starts from it
   * and then ticks — `ViewerClock` explains why the first client render has to match this one
   * exactly, and why the interval is not one second above the final hour.
   *
   * Only while the campaign is live. `daysLeft` is floored at zero, so a campaign that closed
   * a fortnight ago and one closing tonight report the same number, and a countdown on the
   * former would be the loud lie `showDays` already exists to prevent.
   */
  const remaining =
    showDays && campaign.deadline !== null ? remainingUntil(campaign.deadline, now) : null;
  const countdown = remaining === null ? null : countdownLabel(remaining);

  return (
    <header className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
      {/*
        §4.4's media player, which is poster-first and has nothing to play — `CampaignMedia`
        argues that at length rather than shipping a play button over a campaign that has no
        video. It also reserves the 16:9 box before anything loads, so the page's largest
        element does not change height when the photograph decodes.
      */}
      <CampaignMedia campaign={campaign} />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          {badge !== undefined && (
            <Tag variant={badge.variant} className="gap-1.5">
              <span aria-hidden="true" className="flex items-center">
                {badge.icon}
              </span>
              {t(`state.${badge.labelKey}`)}
            </Tag>
          )}

          {urgent && campaign.daysLeft !== null && (
            /*
              The one lime element on the page. A lime FILL with near-black text — lime text
              on a light surface measures 1.3:1 and is prohibited (ui-kit §9.1) — and
              `data-on-lime` so the focus ring flips for anything inside it (§9.3).
            */
            <span
              data-on-lime=""
              className="inline-flex h-[26px] items-center gap-1.5 rounded-sm bg-lime-500 px-2.5 text-xs font-medium text-on-lime"
            >
              <Clock aria-hidden="true" className="size-3" />
              {t('daysLeft', { days: campaign.daysLeft })}
            </span>
          )}

          {campaign.category !== null && (
            <Link
              href={`/discover?category=${encodeURIComponent(campaign.category.slug)}`}
              className="rounded-sm text-xs text-white/64 underline-offset-4 hover:text-white hover:underline"
            >
              {campaign.category.name}
            </Link>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            {campaign.title}
          </h1>
          {campaign.blurb !== null && <p className="text-base text-reading">{campaign.blurb}</p>}
        </div>

        {/*
          THE BYLINE IS ONE SENTENCE WITH A LINK IN IT, not the word "by" and a name after it.
          None of the other three languages has English's preposition here — all three label
          the name and follow it with a colon — so a "before" key and an "after" key would buy
          the link's styling at the cost of word order, which is exactly what a translation is
          entitled to change. `fillNodes` fills the hole with the link.

          It is `campaign.by` rather than `discovery.card.by` even though the two say the same
          thing today. The card's byline belongs to the card — `lib/i18n/card-copy.ts` draws
          that line and keeps only the four sentences both cards share in `common` — and a page
          reaching into another surface's namespace is a page that breaks when that surface is
          redesigned.
        */}
        <p className="text-sm text-white/64">
          {/*
            `raw`, because the creator is a node and next-intl would try to format `{creator}`
            against values this side has none of — `lib/i18n/placeholders.ts` sets out why a
            hole filled with an element is not ICU's job.
          */}
          {fillNodes(String(t.raw('by')), {
            creator: (
              <Link
                href={`/discover?q=${encodeURIComponent(campaign.creator.name)}`}
                className="rounded-sm text-white underline-offset-4 hover:underline"
              >
                {campaign.creator.name}
              </Link>
            ),
          })}
        </p>

        {campaign.goal !== null && (
          <div className="flex flex-col gap-3">
            {/*
              The numbers, and the only client component beneath this page. They are rendered
              here on the server exactly as they always were; what hydration adds is §12.1's
              live counter adding deltas to them. `LiveFunding` argues why that does not break
              #119's server-rendering, and why a socket is opened only when a deployment has
              configured somewhere to open one.
            */}
            <LiveFunding
              projectId={campaign.id}
              goal={campaign.goal}
              pledged={campaign.pledged}
              backersCount={campaign.backersCount}
              realtimeOrigin={realtimeOrigin}
              copy={funding}
            />

            {/*
              `common.card.ofGoal` rather than a key of this page's own: it is word for word the
              sentence both campaign cards print under their bar, and `common.card` exists so
              that the four sentences more than one surface draws have one spelling. The figures
              above it are the block's own words for the reason `campaign-copy.ts` gives — a
              `StatBlock` label stands beside its number rather than containing it.
            */}
            <p className="text-sm text-white/64">
              {common('card.ofGoal', { amount: formatMoney(campaign.goal) })}
              {showDays && campaign.daysLeft !== null && ` · ${t('daysLeft', { days: campaign.daysLeft })}`}
            </p>

            {/*
              IDN-EXT-01 §9: the rule is stated BESIDE the progress bar, not only in the trust
              block further down. A bar that reads 82% means "funded" under this rule and did not
              under the last one, and the reader deciding whether to pledge is looking here.
              Plain text and no motion, like the figures above it.
            */}
            <p className="text-sm text-white/64">{t('rule')}</p>
          </div>
        )}

        {/*
          §4.4's live countdown, beside the figures rather than inside them. It is a separate
          element from the "N days left" sentence above on purpose: that one is the whole-day
          figure the badge and the structured data agree on, and this one moves. Both are
          computed from the same `deadline`, so they cannot drift — `lib/projects/deadline.ts`
          states that as the invariant.
        */}
        {campaign.deadline !== null && countdown !== null && (
          <CampaignCountdown deadline={campaign.deadline} initialLabel={countdown} />
        )}

        {/*
          §4.4's call to action, and the reason the pledge flow is reachable at all.

          ABOVE the save and share controls, because it is what this page is for and those
          three are what a reader does instead. It renders nothing on the seven states that
          cannot be backed, so on a closed campaign the header ends where it always did.
        */}
        <BackCampaignCta
          projectId={campaign.id}
          state={campaign.state}
          deadline={campaign.deadline}
          now={now}
        />

        {/*
          §4.4's save, share and reminder controls. The one client boundary in this header, and
          `CampaignActions` justifies it: all three are writes or browser capabilities, and
          folding them into one island is what keeps the session read to a single subscription.
        */}
        <CampaignActions
          copy={actions}
          projectId={campaign.id}
          state={campaign.state}
          title={campaign.title}
          path={path}
        />
      </div>
    </header>
  );
}
