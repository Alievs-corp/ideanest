'use client';

import { useState, type FormEvent } from 'react';
import { Field, InlineAlert, Pill, Select } from '@ideanest/ui';
import { authorizedFetch } from '../../lib/api/client';
import { useSession } from '../session/SessionProvider';

/**
 * §4.2's P-10, the currency half — issue #327.
 *
 * <h2>THIS USED TO BE A SENTENCE, AND THE SENTENCE WAS RIGHT AT THE TIME</h2>
 *
 * `LanguagePanel` carried three lines of copy stating the currency as a fact, with an
 * argument beside them: §21.2 describes a display currency converted from central-bank
 * rates, the service had no rate source, no rate table and no second currency, and "a
 * selector here would offer to convert manat into manat". #280 chose the sentence over a
 * control with one option or a control with an invented rate, and it chose correctly.
 *
 * #327 built the rate source. What made the sentence right was the absence of a rate rather
 * than the absence of a second <em>project</em> currency — the campaign is still funded in
 * manat and always will be under phase 1, and this control does not change that. A backer in
 * Istanbul reading a manat campaign wants to know roughly what it costs in lira, and that is
 * now answerable with a real rate from a real central bank.
 *
 * <h2>The options come from the SERVICE, not from a list in this repository</h2>
 *
 * Which currencies are available is a property of what the central bank published and when
 * the platform last reached it — so a currency offered last week is not offered this week if
 * the source stopped publishing it. `page.tsx` reads `/v1/exchange-rates` on the server (it
 * is public and cacheable, so this costs no round trip after hydration) and hands the list
 * down. A hard-coded list here would be a second copy of the truth, wrong on exactly the day
 * it matters.
 *
 * <h2>When the platform can offer nothing, this is a sentence again</h2>
 *
 * A deployment with the feature switched off, or one whose source has been unreachable past
 * its limit, has one currency to offer and it is the one every amount is already in. The
 * panel says so rather than drawing a `<select>` with a single option — which is a control
 * that cannot be used, the exact thing #280 refused.
 *
 * <h2>It says what a display currency IS, every time</h2>
 *
 * §21.2: the figure is an approximation and collection occurs in the project's currency. A
 * backer who believed otherwise would be one who thinks they are being charged in dollars,
 * and would find out from their card statement. The hint under the control is not decoration.
 *
 * <h2>Motion: none</h2>
 *
 * `docs/motion-system.md` §5 — "authentication, account settings: none". The 150ms belongs to
 * the input skin and the button; this file adds no entry animation and no `FadeUp`.
 */

/** Every string this panel draws, resolved on the server. */
export interface CurrencyPanelCopy {
  readonly fieldLabel: string;
  readonly fieldHint: string;
  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly failed: string;
  /** Shown instead of the control when the platform has nothing to offer. */
  readonly unavailable: string;
}

export interface CurrencyPanelProps {
  readonly copy: CurrencyPanelCopy;
  /**
   * What a reader may choose: the platform's own currency first, then every one with a
   * fresh rate behind it.
   *
   * <p>The platform's own is always present and is always first, because it is the default
   * and the way out of a choice somebody regrets — a reader who cannot undo a setting
   * because a third party is down is a reader stuck with a stale approximation.
   */
  readonly currencies: readonly string[];
  /** What every rate is expressed in. The value that means "no approximation". */
  readonly baseCurrency: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function CurrencyPanel({ copy, currencies, baseCurrency }: CurrencyPanelProps) {
  const { session, refresh } = useSession();

  /*
   * `null` means "this reader has not touched the control", which is a different fact from
   * "this reader chose the currency they already have": the first has to follow the session
   * as it changes underneath, and the second must not. The same distinction `LanguagePanel`
   * draws, and for the same reason.
   */
  const [chosen, setChosen] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('idle');

  /*
   * The account's currency, or the platform's while the session is still being read. Not
   * held in state: `refresh()` produces a new session object after a save, and a value
   * initialised once would ignore it.
   */
  const current = session?.currency ?? baseCurrency;
  const value = chosen ?? current;

  /*
   * One option is not a choice. A deployment with the feature off, or one whose source has
   * been unreachable past its limit, offers only the currency every amount is already in —
   * and a `<select>` with a single option is a control that cannot be used.
   */
  if (currencies.length < 2) {
    return (
      <section className="rounded-2xl border border-fg/8 bg-surface-2 p-6 sm:p-8">
        <p className="max-w-[58ch] text-sm text-fg-64">{copy.unavailable}</p>
      </section>
    );
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (state === 'saving') return;

    setState('saving');
    try {
      const response = await authorizedFetch('/v1/me/currency', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currency: value }),
      });
      if (!response.ok) throw new Error('refused');
    } catch {
      /*
       * One sentence for every failure, as `LanguagePanel` argues. The service refuses
       * exactly two things here — a malformed code, which this control cannot produce, and a
       * currency it can no longer price, which happens when the source stopped publishing
       * between this page rendering and this button being pressed. Both are answered by
       * reloading the page, which is what "try again" means.
       */
      setState('failed');
      return;
    }

    setState('saved');
    /*
     * The session carries the currency, and the header, the pledge list and the checkout all
     * read it from there. Without this they would keep showing the old approximation until
     * the next full page load.
     */
    await refresh();
  }

  return (
    <section className="rounded-2xl border border-fg/8 bg-surface-2 p-6 sm:p-8">
      <form onSubmit={save} noValidate className="flex max-w-[30rem] flex-col gap-5">
        <Field label={copy.fieldLabel} hint={copy.fieldHint}>
          <Select
            name="currency"
            value={value}
            onChange={(event) => {
              setChosen(event.target.value);
              // The last outcome is about the currency that was saved, not the one now
              // selected. Leaving "Currency saved." above a different choice would be a true
              // sentence in a place that makes it read as false.
              setState('idle');
            }}
            disabled={state === 'saving'}
          >
            {currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          `empty:hidden` so the region occupies no row in the column's gap while it has
          nothing to say. Rendered on every state rather than only on success, because a live
          region announces what changes inside it and not the fact of its own arrival.
        */}
        <div role="status" aria-live="polite" className="empty:hidden">
          {state === 'saved' && <InlineAlert variant="success">{copy.saved}</InlineAlert>}
        </div>

        {state === 'failed' && <InlineAlert variant="danger">{copy.failed}</InlineAlert>}

        <div>
          <Pill type="submit" disabled={state === 'saving'}>
            {state === 'saving' ? copy.saving : copy.save}
          </Pill>
        </div>
      </form>
    </section>
  );
}
