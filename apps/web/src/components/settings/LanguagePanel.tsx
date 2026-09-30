'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from '../../i18n/navigation';
import { Field, InlineAlert, Pill, Select } from '@ideanest/ui';
import { authorizedFetch } from '../../lib/api/client';
import { errorFrom } from '../../lib/api/problem';
import { writeLocaleCookie } from '../../lib/i18n/cookie';
import { LOCALE_NAMES, SUPPORTED_LOCALES, isLocale, type Locale } from '../../lib/i18n/locale';

/**
 * §4.2's P-10, language half — issue #280.
 *
 * <h2>The endonyms are the whole accessibility argument for this screen</h2>
 *
 * Every option is named in its own language, from `LOCALE_NAMES`, and never translated into
 * the language the page happens to be drawn in. This screen's one hard case is somebody who
 * landed in a language they cannot read — a shared machine, a mistaken tap, an account
 * created for them by somebody else — and "Azerbaijani" spelled in Russian is unreadable to
 * exactly that person. `Азербайджанский` is a dead end; `Azərbaycan dili` is a way out.
 *
 * Each option also carries its own `lang`, so a screen reader pronounces `Русский` with
 * Russian phonemes rather than reading it as mangled English. `lang` is valid on any element
 * and overrides for its subtree, which is the standard mechanism for a list that is
 * deliberately in four languages at once.
 *
 * <h2>The control is a native `<select>`</h2>
 *
 * docs/ui-kit.md §7.13 — "the native `<select>` is a decision, not a shortcut". Four fixed
 * options is precisely the case it names: a hand-built listbox would owe type-ahead, Home/End,
 * PageUp/PageDown, the announcement contract and the platform wheel picker on iOS and Android,
 * and it is the type-ahead that matters most here — somebody looking for their own language
 * types the first letter of a word they recognise.
 *
 * `Field` wraps it so the label, the hint, `aria-describedby` and `aria-invalid` come from the
 * primitive rather than from four attributes somebody has to remember. §7.13: "a hint the
 * assistive layer never reaches is decoration".
 *
 * <h2>Saving writes twice, deliberately</h2>
 *
 * `PATCH /v1/me/locale` is the durable record — it is the language the service composes mail
 * in, which `LocalePreferenceController` explains has never been choosable until now. The
 * cookie is what a **render** reads, because a server render must not wait on an API call to
 * know which catalogue to load (`src/i18n/request.ts`). Writing only the account would leave
 * this very page in the old language until something else happened to set the cookie; writing
 * only the cookie would leave the account's mail in a language nobody chose.
 *
 * `router.refresh()` then re-renders the server tree, which re-reads the cookie through
 * `src/i18n/request.ts` and redraws the account area in the language just chosen. It comes
 * after the cookie write for that reason and would be a no-op before it.
 *
 * <h2>What this deliberately does not do: re-read `GET /v1/me`</h2>
 *
 * Nothing in the client reads `session.locale` except `SessionProvider`, which keeps the cookie
 * and the account in step by `lib/i18n/sync.ts`'s last-synced rule (#216) — and this panel has
 * just made them agree directly. The next session read sees the account carrying the cookie's
 * value and records it as synced; nothing here needs to. Spending a round trip to be told the
 * value we just wrote would be a request that can only confirm what we already know.
 *
 * <h2>The call is inline rather than in a `lib/` module</h2>
 *
 * One endpoint, one field, no response body to shape and no refusal to branch on: the service
 * validates the four tags before the handler runs and answers 204 or 400, so a wrapper would
 * be a re-export of `authorizedFetch` with a longer name. The panels that do have a module
 * behind them — `lib/auth/credentials.ts`, `lib/account/closure.ts` — have one because they
 * translate several problem codes into several field errors.
 *
 * <h2>The currency moved out of this file with #327</h2>
 *
 * It used to end with three lines of copy stating the currency as a fact, and an argument
 * for why: §21.2 describes a display currency converted from central-bank rates, the service
 * had no rate source and no rate table, and "a selector here would offer to convert manat
 * into manat". That was right, and #327 built the rate source — so it is a control now, in
 * `CurrencyPanel`, and a separate one rather than a second field on this form. Two
 * preferences with one Save would mean a language that failed to save because a currency did.
 *
 * <h2>Success and failure are text plus an icon, never a colour</h2>
 *
 * docs/ui-kit.md §9.2. `InlineAlert` pairs each variant with its own icon, so the message
 * still reads for somebody with a colour-vision deficiency, in a high-contrast mode, or on a
 * printout. Success is `--success` with `CircleCheck` and **never lime** — lime says "act
 * now", and a saved preference is the opposite of an outstanding task (§8.1). The failure is
 * `--danger` with `CircleAlert` and a sentence that says what to do about it.
 *
 * The success message sits inside a permanent polite live region rather than appearing as new
 * content, because a region that is created at the same moment it is filled is one many screen
 * readers never announce. The failure carries `role="alert"` from `InlineAlert` itself.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 — "authentication, account settings: none — 150ms colour on
 * controls". The 150ms belongs to the input skin and the button, and this file adds no entry
 * animation, no transition and no `FadeUp`.
 */

/** Every string this panel draws, resolved on the server. */
export interface LanguagePanelCopy {
  readonly fieldLabel: string;
  readonly fieldHint: string;
  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly failed: string;
}

export interface LanguagePanelProps {
  /**
   * The strings, handed down rather than read here.
   *
   * `useTranslations` in a client component needs a `NextIntlClientProvider` above it, and
   * putting one over this screen would ship a whole language's catalogue into the route's
   * first load to draw nine strings. The server already has the catalogue open — #324 wired
   * `getTranslations` — so the page reads them there and passes them through, and the browser
   * downloads only the nine.
   */
  readonly copy: LanguagePanelCopy;

  /**
   * The language the server drew this page in, from the cookie.
   *
   * It is a prop rather than a `currentLocaleCookie()` call in this component because that
   * call answers `null` during the server render and the real cookie during hydration, which
   * is a hydration mismatch for everybody whose language is not the default. It is also not
   * held in `useState`: after a save, `router.refresh()` produces a new server render with a
   * new value, and state initialised once would ignore it.
   */
  readonly serverLocale: Locale;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function LanguagePanel({ copy, serverLocale }: LanguagePanelProps) {
  const router = useRouter();

  /*
   * `null` means "this reader has not touched the control", which is a different fact from
   * "this reader chose the language the page is already in": the first has to follow the
   * server's value as it changes underneath, and the second must not.
   */
  const [chosen, setChosen] = useState<Locale | null>(null);
  const [state, setState] = useState<SaveState>('idle');

  const value = chosen ?? serverLocale;

  function choose(next: string): void {
    /*
     * A `<select>` hands back a string, and the four options are the only values it can
     * produce — but the guard is here rather than a cast because an untrusted string is what
     * every boundary in `lib/i18n` narrows, and a cast would be the one place that trusts the
     * DOM to have kept its own options.
     */
    if (!isLocale(next)) return;

    setChosen(next);

    /*
     * The last outcome is about the language that was saved, not about the one now selected.
     * Leaving "Language saved." above a different choice would be a true sentence in a place
     * that makes it read as false.
     */
    setState('idle');
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (state === 'saving') return;

    setState('saving');

    try {
      const response = await authorizedFetch('/v1/me/locale', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: value }),
      });

      if (!response.ok) throw await errorFrom(response);
    } catch {
      /*
       * One sentence for every failure, and that is a decision rather than laziness. The
       * service refuses exactly one thing here — a tag that is not one of the four — and this
       * control cannot produce one, so every refusal that can actually reach a reader is a
       * network fault, an expired session or an outage. None of those is distinguishable from
       * the others by anything they can do about it, and all of them are answered by trying
       * again.
       */
      setState('failed');
      return;
    }

    writeLocaleCookie(value);
    setState('saved');
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <form onSubmit={save} noValidate className="flex max-w-[30rem] flex-col gap-5">
        <Field label={copy.fieldLabel} hint={copy.fieldHint}>
          <Select
            name="locale"
            value={value}
            onChange={(event) => choose(event.target.value)}
            disabled={state === 'saving'}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale} lang={locale}>
                {LOCALE_NAMES[locale]}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          `empty:hidden` so the region occupies no row in the column's gap while it has nothing
          to say. It is rendered on every state rather than only on success, because a live
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
