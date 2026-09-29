'use client';

import { Ban } from 'lucide-react';
import { Card, Select } from '@ideanest/ui';
import { formatMoney } from '../../lib/money';
import { isSoldOut, type PublicReward } from '../../lib/pledges/api';
import type { CheckoutCopy } from '../../lib/i18n/checkout-copy';

/**
 * PL-04: add-ons, with quantities.
 *
 * <h2>A `<select>` rather than a stepper</h2>
 *
 * The quantity is a small whole number from a bounded range, which is the case
 * docs/ui-kit.md §7.13 hands to the native control: it brings type-ahead, Home
 * and End, the platform wheel picker on a phone, and an announcement contract
 * that a pair of plus and minus buttons would have to re-implement and would get
 * one of wrong. A stepper would also need two accessible names per add-on and
 * would still leave "set it to seven" as seven presses.
 *
 * <h2>The cap is a display decision, not a rule</h2>
 *
 * A limited add-on offers up to what is left. An unlimited one offers up to ten,
 * which is a list length rather than a limit — the service is what enforces
 * availability, and a client that thought otherwise would be a second, stale
 * answer to a question the reservation already asks under a row lock.
 */

/** The longest list an unlimited add-on offers. Not a limit; see above. */
const UNLIMITED_DISPLAY_CAP = 10;

export interface AddonChoiceProps {
  /**
   * The words this control draws, resolved on the server and handed down by `CheckoutView`.
   * `lib/i18n/checkout-copy.ts` explains why the checkout's copy travels as a prop.
   */
  copy: CheckoutCopy['addons'];
  addons: readonly PublicReward[];
  quantityOf: (rewardId: string) => number;
  onChange: (rewardId: string, quantity: number) => void;
  disabled?: boolean;
}

function optionsFor(addon: PublicReward): readonly number[] {
  const limit =
    addon.remainingQuantity == null
      ? UNLIMITED_DISPLAY_CAP
      : Math.min(addon.remainingQuantity, UNLIMITED_DISPLAY_CAP);

  return Array.from({ length: limit + 1 }, (_, index) => index);
}

export function AddonChoice({ addons, quantityOf, onChange, disabled = false,
  copy,
}: AddonChoiceProps) {
  if (addons.length === 0) return null;

  return (
    <section aria-labelledby="checkout-addons" className="flex flex-col gap-3">
      <div>
        {/*
        AN `<h2>`, NOT AN `<h3>` — #129. This section sits directly under the checkout's
        `<h1>`; the reward chooser beside it is a labelled `radiogroup` rather than a headed
        section, so this was the first heading on the step and it skipped a level. A reader
        navigating by heading went from "Choose your reward" into "Add-ons" and was told,
        wrongly, that they had descended two levels into something.

        The size is unchanged: `text-sm` is what the design asks for here, and a heading's
        level is its place in the document rather than its size on the page.
      */}
      <h2 id="checkout-addons" className="text-sm font-medium text-white">
          {copy.heading}
        </h2>
        <p className="mt-1 text-[13px] text-white/64">
          {copy.intro}
        </p>
      </div>

      {addons.map((addon) => {
        const soldOut = isSoldOut(addon);

        return (
          <Card key={addon.id} className={soldOut ? 'p-4 opacity-50' : 'p-4'}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-white">
                  <span className="font-medium">{addon.title}</span>
                  <span className="tabular-nums text-white/64">{formatMoney(addon.price)}</span>
                </p>
                {addon.description != null && addon.description !== '' && (
                  <p className="mt-1 text-[13px] text-white/64">{addon.description}</p>
                )}
              </div>

              {soldOut ? (
                /*
                 * Words and a glyph, not a dimmed control. A disabled select
                 * saying "0" is indistinguishable from one the backer set to
                 * zero themselves (docs/ui-kit.md §9.2).
                 */
                <p className="inline-flex items-center gap-1.5 text-[13px] text-white/64">
                  <Ban aria-hidden="true" className="size-3.5 shrink-0" />
                  {copy.soldOut}
                </p>
              ) : (
                <label className="flex items-center gap-2 text-[13px] text-white/64">
                  {copy.quantity}
                  {/*
                    The add-on's title is part of the accessible name because a
                    page of eight selects all called "Quantity" is unusable by
                    ear. The comma is load-bearing for the reason `EditorShell`
                    gives: the name is its parts trimmed and concatenated with no
                    separator, so a leading space would be dropped and the name
                    would read "QuantityEnamel mug".
                  */}
                  <span className="sr-only">, {addon.title}</span>
                  <Select
                    size="sm"
                    className="w-20"
                    value={String(quantityOf(addon.id))}
                    disabled={disabled}
                    onChange={(event) => {
                      // The option values are written by `optionsFor`, so this is
                      // a fixed set of small integers rather than typed input —
                      // and it never touches money, which is `Decimal`'s alone.
                      onChange(addon.id, Number.parseInt(event.currentTarget.value, 10));
                    }}
                  >
                    {optionsFor(addon).map((quantity) => (
                      <option key={quantity} value={quantity}>
                        {quantity}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </div>
          </Card>
        );
      })}
    </section>
  );
}
