'use client';

import { Ban } from 'lucide-react';
import { Card, Field, Radio, RadioGroup, Tag } from '@ideanest/ui';
import { formatMoney } from '../../lib/money';
import { isShipped, isSoldOut, type PublicReward } from '../../lib/pledges/api';
import { NO_REWARD } from './useCheckout';
import { type CheckoutCopy, fillPlaceholders } from '../../lib/i18n/checkout-copy';
import { dateTimeFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

/**
 * PL-01, PL-02 and PL-15: the tiers, in the order the campaign put them in, with
 * live stock — and "pledge without a reward" as one of the choices rather than a
 * link in small print.
 *
 * <h2>A sold-out tier is shown, not hidden</h2>
 *
 * Removing it tells a backer the campaign never offered it, which is both untrue
 * and unhelpful: they came from a project page that listed it, and an interface
 * that quietly drops it leaves them looking for something they can see elsewhere.
 * It is rendered inert instead — a real `disabled` radio, so the platform
 * announces it as unavailable and it cannot be chosen by keyboard, by pointer, or
 * by a form submission that skipped both — with the words "Sold out" and a glyph
 * beside them, because colour alone must never carry meaning (docs/ui-kit.md
 * §9.2) and a dimmed card is exactly that.
 *
 * <h2>The lime is the radio, and nothing else</h2>
 *
 * §8.1 maps "selected reward tier" to `--lime-500`, and §7.13 says why that is
 * already satisfied here: "§8.1 already reads --lime-500 as 'active choice' for a
 * selected reward tier. A ticked box is the same gesture." The `Radio` primitive
 * fills lime when checked. Filling the CARD lime as well would put a lime radio
 * on a lime ground, where it measures nothing at all — and §8.5 reserves the
 * screen's lime for the confirm button, which lives on the step after this one.
 * The selected card takes `--surface-4`, the token §2.1 gives to "hover,
 * selected".
 */

export interface RewardChoiceProps {
  /**
   * The words this control draws, resolved on the server and handed down by `CheckoutView`.
   * `lib/i18n/checkout-copy.ts` explains why the checkout's copy travels as a prop.
   */
  copy: CheckoutCopy['reward'];
  rewards: readonly PublicReward[];
  /** The chosen tier id, `NO_REWARD`, or null when nothing is chosen yet. */
  value: string | null;
  onChange: (value: string) => void;
  /** True once stock is reserved: the selection is the server's until it is not. */
  disabled?: boolean;
}

/**
 * `2026-11-01` as `November 2026`.
 *
 * A month, because a month is what a creator can honestly promise — the same
 * reasoning the reward editor states about the field. The date is read in UTC:
 * the service stores a plain date and rendering it in the reader's zone would
 * move a first-of-the-month delivery into the month before it.
 */
function deliveryMonth(date: string, locale: Locale): string | null {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return null;

  return dateTimeFormat(
    locale,
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
    'delivery-month',
  ).format(new Date(parsed));
}

function StockLine({
  reward,
  copy,
}: {
  reward: PublicReward;
  copy: CheckoutCopy['reward'];
}) {
  /*
   * NO COUNTER AT ALL FOR AN UNLIMITED TIER. `limitQuantity: null` means the
   * creator set no cap, and printing "unlimited" or an infinity glyph invents a
   * scarcity conversation the campaign deliberately did not start.
   */
  if (reward.limitQuantity == null) return null;

  if (isSoldOut(reward)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-white/64">
        <Ban aria-hidden="true" className="size-3.5 shrink-0" />
        {copy.soldOut}
      </span>
    );
  }

  return (
    <span className="tabular-nums text-white/64">
      {fillPlaceholders(copy.left, {
        remaining: String(reward.remainingQuantity ?? reward.limitQuantity),
        limit: String(reward.limitQuantity),
      })}
    </span>
  );
}

function RewardDetail({
  reward,
  copy,
}: {
  reward: PublicReward;
  copy: CheckoutCopy['reward'];
}) {
  const locale = useRouteLocale();
  const delivery =
    reward.estimatedDelivery == null ? null : deliveryMonth(reward.estimatedDelivery, locale);

  return (
    <span className="flex flex-col gap-2">
      {reward.description != null && reward.description !== '' && <span>{reward.description}</span>}

      {reward.items.length > 0 && (
        <span className="flex flex-col gap-0.5">
          {reward.items.map((item) => (
            <span key={`${item.name}-${item.quantity}`}>
              {item.quantity} × {item.name}
              {item.isDigital && <span className="text-white/40"> — {copy.digitalItem}</span>}
            </span>
          ))}
        </span>
      )}

      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {delivery != null && (
          <span className="text-white/64">
            {fillPlaceholders(copy.estimatedDelivery, { month: delivery })}
          </span>
        )}
        {isShipped(reward.shippingType) ? (
          <span className="text-white/64">
            {reward.shippingType === 'DOMESTIC' ? copy.postedDomestic : copy.postedWorldwide}
          </span>
        ) : reward.shippingType === 'LOCAL_PICKUP' ? (
          <span className="text-white/64">{copy.inPerson}</span>
        ) : reward.shippingType === 'DIGITAL' ? (
          <span className="text-white/64">{copy.digital}</span>
        ) : null}
        <StockLine reward={reward} copy={copy} />
      </span>
    </span>
  );
}

export function RewardChoice({ rewards, value, onChange, disabled = false,
  copy,
}: RewardChoiceProps) {
  return (
    <Field grouped label={copy.legend} hint={copy.hint}>
      <RadioGroup value={value ?? ''} onValueChange={onChange}>
        {/*
          PL-02 IS FIRST AND IS A CHOICE. Support with no reward is how a good
          part of any campaign is funded, and putting it under the tiers as a
          "or just give" link makes it read as the option for people who could
          not afford one of the real ones.
        */}
        <Card className="p-4">
          <Radio
            value={NO_REWARD}
            disabled={disabled}
            label={copy.none}
            description={copy.noneHint}
          />
        </Card>

        {rewards.map((reward) => {
          const soldOut = isSoldOut(reward);
          const selected = value === reward.id;

          return (
            <Card
              key={reward.id}
              className={[
                'p-4',
                // §8.1's "suspended" treatment: inert, not invisible. The words
                // "Sold out" carry the meaning; the opacity only supports them.
                soldOut ? 'opacity-50' : '',
                selected ? 'bg-surface-4' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <Radio
                value={reward.id}
                disabled={disabled || soldOut}
                label={
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-medium">{reward.title}</span>
                    <span className="tabular-nums text-white/64">{formatMoney(reward.price)}</span>
                    {reward.isEarlyBird && <Tag>{copy.earlyBird}</Tag>}
                    {reward.isFeatured && <Tag>{copy.featured}</Tag>}
                  </span>
                }
                description={<RewardDetail reward={reward} copy={copy} />}
              />
            </Card>
          );
        })}
      </RadioGroup>
    </Field>
  );
}
