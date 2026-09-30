'use client';

import { useMemo } from 'react';
import { Field, Select } from '@ideanest/ui';
import type { CheckoutCopy } from '../../lib/i18n/checkout-copy';
import { regionNames } from '../../lib/i18n/formats';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

/**
 * PL-05: where the pledge is going, and only when something in it is posted.
 *
 * <h2>The control is absent, not disabled, for a digital pledge</h2>
 *
 * `useCheckout` renders this only when the selection contains a `DOMESTIC` or
 * `INTERNATIONAL` line. Asking a backer for a country in order to deliver a
 * download is asking for information the campaign has no reason to hold (§17.4),
 * and it is the visible half of a shipping model that has not understood what it
 * is charging for.
 *
 * <h2>Country names come from `Intl`, not from a table in this repository</h2>
 *
 * `Intl.DisplayNames` already holds every ISO 3166-1 region name, in every
 * language the product ships in (§21.1), maintained by the platform. The route's
 * language picks them — `regionNames` in `packages/messages/src/formats.ts` (#133). A checked-in
 * list of two hundred names would be a second copy to keep current, would be
 * English-only, and would be wrong the next time a country renames itself. The
 * code is shown when the runtime has no name for it, which is the honest fallback
 * — a destination the creator priced is one the backer can still choose.
 *
 * <h2>What is offered, and what is refused</h2>
 *
 * The options are the union of every destination the selected shipping lines
 * price. A country priced for the reward but not for an add-on is therefore
 * offered and then refused, by name, with the line that refuses it — see
 * `unpricedLines`. That is deliberate: silently omitting it would leave somebody
 * hunting for a destination the campaign page told them existed.
 */

export interface DestinationFieldProps {
  /**
   * The words this control draws, resolved on the server and handed down by `CheckoutView`.
   * `lib/i18n/checkout-copy.ts` explains why the checkout's copy travels as a prop.
   */
  copy: CheckoutCopy['destination'];
  /** ISO 3166-1 alpha-2 codes the creator has priced for the selected lines. */
  options: readonly string[];
  value: string | null;
  onChange: (code: string | null) => void;
  /** The refusal for the chosen destination, already worded. */
  error?: string | null;
  disabled?: boolean;
}

/** `AZ` as `Azerbaijan`, or as `AZ` where the runtime has no name for it. */
export function countryName(code: string, display: Intl.DisplayNames | null): string {
  if (display === null) return code;
  try {
    return display.of(code) ?? code;
  } catch {
    // `of` throws on anything that is not a well-formed region code. A malformed
    // rate row is the creator's data problem and not a reason to fail the page.
    return code;
  }
}

export function DestinationField({
  options,
  value,
  onChange,
  error = null,
  disabled = false,
  copy,
}: DestinationFieldProps) {
  const locale = useRouteLocale();
  const display = useMemo(() => regionNames(locale), [locale]);

  const named = useMemo(
    () =>
      options
        .map((code) => ({ code, name: countryName(code, display) }))
        .sort((left, right) => left.name.localeCompare(right.name, locale)),
    [options, display, locale],
  );

  return (
    <Field
      label={copy.label}
      required
      hint={copy.hint}
      error={error}
    >
      <Select
        placeholder={copy.placeholder}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next === '' ? null : next);
        }}
      >
        {named.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
