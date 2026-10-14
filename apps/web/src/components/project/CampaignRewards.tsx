import { Link } from '../../i18n/navigation';
import { CalendarClock, Truck } from 'lucide-react';
import { Tag } from '@ideanest/ui/server';
import type { RewardShipping } from '@ideanest/campaign/reward-details';
import { formatMoney, type Money } from '../../lib/money';
import type { CampaignRewardTier } from '../../lib/projects/publicPage';
import type { ProjectState } from '../../lib/projects/api';
import { acceptsPledges } from '../../lib/projects/pledgeable';
import { deliveryMonth } from '../../lib/i18n/delivery-month';
import { localeOrDefault } from '../../lib/i18n/locale';
import { getLocale, getTranslations } from 'next-intl/server';

/**
 * The reward tiers a backer chooses between — §4.4's right-hand column, server-rendered.
 *
 * <h2>What this is and what it is not</h2>
 *
 * A **read-only list**, in the initial HTML, because a crawler that cannot see what a
 * campaign offers cannot describe it and a link unfurler has nothing to preview. It is the
 * same data `structured-data/product.ts` turns into `Product` nodes on this page, read from
 * the same fetch, so the machine-readable and human-readable halves of the page cannot
 * disagree about what a tier costs.
 *
 * **Choosing one starts here and finishes in §4.5.** Each tier carries a link to
 * `/projects/{id}/back?reward={tier}`, and that is the whole of the interaction: no state, no
 * price lock, no reservation. Until this landed the list said what a campaign offered and
 * offered no way to take any of it — this file's own comment named the missing control as
 * "the next thing this page wants", and it went on wanting it through four releases while
 * the checkout behind it was complete and tested.
 *
 * <p><strong>What it must not become is a second, half-implemented checkout.</strong> The
 * link carries an identifier the page already printed and nothing else. `useCheckout`
 * explains why the pledge itself is never in a URL: a half-made pledge is not shareable, and
 * a back button must not be able to re-enter a reservation that has expired. A tier
 * identifier is neither — it is public catalogue data, it reserves nothing, and the checkout
 * re-fetches the catalogue and re-prices the selection inside the transaction that reserves
 * it, so a stale link costs a preselection and never a wrong total.
 *
 * <h2>Sold out is shown, never hidden</h2>
 *
 * PL-01, and `PublicReward.remainingQuantity` states it: a tier with zero places left stays
 * on the page. Hiding it tells a backer the campaign never offered it, and the interface can
 * then not explain why the total they were quoted a minute ago is unavailable. `null` means
 * unlimited and is the common case; zero is a real number and is not the same thing.
 *
 * **A sold-out tier gets no control**, rather than a disabled one. There is nothing behind it
 * — the service refuses the draft with `REWARD_SOLD_OUT` — and a control that exists to be
 * refused teaches a reader that this page's buttons do not work.
 *
 * <h2>When it arrives and where it can go — #255</h2>
 *
 * A backer chooses a reward by when it arrives and whether it can reach them, so every card says
 * both before the checkout does: the estimated delivery month, and one shipping line — how many
 * countries the creator has priced and the cheapest rate, or that nothing is shipped. The
 * checkout's two tags, early bird and featured, are on the card in the checkout's words.
 * `@ideanest/campaign/reward-details` reads all of it, the same way the app does. The items and
 * the add-ons stay in the checkout, which has the room for them; the card stays short.
 *
 * <h2>Colour</h2>
 *
 * No lime. §8.1 maps `--lime-500` to a *selected* reward tier — an active choice — and
 * nothing on this list is selected: selection happens on the screen the link leads to, which
 * is where §8.5 puts the one lime element. The controls here are §7.2's `.pill--outline`,
 * which is what a secondary action looks like on a `--surface-2` card, and the page's single
 * white primary pill stays in the header where `BackCampaignCta` draws it.
 */
export interface CampaignRewardsProps {
  readonly tiers: readonly CampaignRewardTier[];
  /** The campaign's identifier — the `[id]` segment the checkout is reached by. */
  readonly projectId: string;
  readonly state: ProjectState;
  /** ISO 8601, or `null` on a campaign with no funding window. */
  readonly deadline: string | null;
  /**
   * The instant the deadline is measured against. Defaults to the real clock.
   *
   * Injected for the reason `CampaignSummaryProps.now` gives, and nothing in the application
   * passes it: a test has to be able to ask what this list looks like a minute after a
   * campaign closed without waiting for that minute.
   */
  readonly now?: Date;
}

export async function CampaignRewards({
  tiers,
  projectId,
  state,
  deadline,
  now = new Date(),
}: CampaignRewardsProps) {
  const t = await getTranslations('campaign.rewards');
  // The checkout's own words for the tags and the month, so the two pages agree.
  const checkout = await getTranslations('checkout.reward');
  const locale = localeOrDefault(await getLocale());

  if (tiers.length === 0) return null;

  /** The shipping line, or `null` for a shipped tier with nowhere priced yet. */
  const shippingLine = (shipping: RewardShipping, price: Money): string | null => {
    switch (shipping.kind) {
      case 'none':
        return t('shipping.none');
      case 'digital':
        return t('shipping.digital');
      case 'pickup':
        return t('shipping.pickup');
      case 'ships':
        return shipping.lowestRate === null
          ? t('shipping.shipsTo', { count: shipping.countries })
          : t('shipping.shipsToFrom', {
              count: shipping.countries,
              // A rate table is in the campaign's currency, which is the tier's.
              amount: formatMoney({ amount: shipping.lowestRate, currency: price.currency }),
            });
      case 'unpriced':
        return null;
    }
  };

  /*
   * Asked once for the list rather than once per tier. The same function answers it for the
   * header's control and for the `Offer` nodes in this page's structured data, which is what
   * stops a crawler being told a tier is purchasable by a page that offers no way to buy it.
   */
  const pledgeable = acceptsPledges(state, deadline, now);

  return (
    <section aria-labelledby="campaign-rewards" className="flex flex-col gap-4">
      <h2 id="campaign-rewards" className="text-xl font-medium tracking-[-0.02em] text-white">
        {t('heading')}
      </h2>

      <ul className="flex flex-col gap-3">
        {tiers.map((tier) => {
          const soldOut = tier.remainingQuantity === 0;
          const { details } = tier;
          const month =
            details.estimatedDelivery === null ? null : deliveryMonth(details.estimatedDelivery, locale);
          const shipping = shippingLine(details.shipping, tier.price);

          return (
            <li
              key={tier.id}
              className="flex flex-col gap-2 rounded-lg border border-white/8 bg-surface-2 p-5"
            >
              <p className="font-display text-2xl font-semibold tracking-[-0.03em] text-white tabular-nums">
                {formatMoney(tier.price)}
              </p>
              <h3 className="text-base font-medium text-white">{tier.title}</h3>
              {(details.earlyBird || details.featured) && (
                /* Words, in the checkout's `default` skin: neither is a verdict or an urgency. */
                <p className="flex flex-wrap gap-2">
                  {details.earlyBird && <Tag variant="default">{checkout('earlyBird')}</Tag>}
                  {details.featured && <Tag variant="default">{checkout('featured')}</Tag>}
                </p>
              )}
              {tier.description !== null && (
                <p className="text-sm text-reading">{tier.description}</p>
              )}

              {month !== null && (
                <p className="flex items-center gap-2 text-sm text-white/64">
                  <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
                  {checkout('estimatedDelivery', { month })}
                </p>
              )}
              {shipping !== null && (
                <p className="flex items-center gap-2 text-sm text-white/64">
                  <Truck aria-hidden="true" className="size-4 shrink-0" />
                  {shipping}
                </p>
              )}

              {tier.remainingQuantity !== null && (
                /*
                 * A word and a number, never a colour on its own (§9.2). "Sold out" is the
                 * fact a reader needs; a greyed-out card would tell somebody with a
                 * colour-vision deficiency nothing at all.
                 */
                <p className="text-sm text-white/64">
                  {soldOut ? t('soldOut') : t('remaining', { count: tier.remainingQuantity })}
                </p>
              )}

              {pledgeable && !soldOut && (
                <Link
                  href={`/projects/${encodeURIComponent(projectId)}/back?reward=${encodeURIComponent(tier.id)}`}
                  /*
                   * THE NAME SAYS WHICH TIER, THE LABEL SAYS WHAT PRESSING IT DOES.
                   *
                   * A list of six links all called "Select this reward" is unusable by ear —
                   * ui-kit §7.3 makes the same argument about the removable chip. The
                   * accessible name still CONTAINS the visible text, or speech input cannot
                   * reach the control by the words printed on it (WCAG 2.5.3).
                   */
                  aria-label={t('selectNamed', { title: tier.title })}
                  className="mt-1 inline-flex h-10 w-fit items-center rounded-full border border-white/16 px-5 text-sm font-medium text-white transition-colors duration-150 ease-in-out hover:bg-surface-3"
                >
                  {t('select')}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
