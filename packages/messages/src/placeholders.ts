import { Fragment, createElement, type ReactNode } from 'react';

/**
 * Filling `{name}` in a message that was resolved on the server — issue #324.
 *
 * <h2>Why the value is not interpolated where the message is read</h2>
 *
 * The pattern this application uses everywhere is that a server component resolves the copy
 * once and hands a plain object to the client component that draws it — `lib/i18n/shell-copy.ts`
 * carries the measurement that made a `NextIntlClientProvider` the wrong answer. A server
 * cannot fill in a value it does not have: the address somebody typed into the register form,
 * the number of minutes left on a rate limit, the month a reward ships. Those are known one
 * render later and one component down.
 *
 * So the catalogue carries the sentence with a hole in it and the component fills the hole.
 * The hole is ICU's own `{name}` spelling rather than a convention of ours, so a translator
 * meets the same placeholder here as in a string that next-intl formats itself, and a message
 * can be moved between the two without being rewritten.
 *
 * <h2>What this deliberately does not do</h2>
 *
 * No plurals, no gender, no ordinals, no dates. Those are ICU's and they need the locale, the
 * catalogue and the runtime — which is `t()` on the server, where they are already available.
 * A value that needs one of them does not belong in a template that crossed a component
 * boundary as a string; it belongs in a key resolved beside the number it is about.
 */

/** Every `{name}` replaced by `values[name]`, and anything unmatched left exactly as it was. */
export function fillPlaceholders(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (whole, name: string) => values[name] ?? whole);
}

/**
 * The same substitution, for a value that is a node rather than a string.
 *
 * An echoed email address is styled — `text-white` against the paragraph's `text-white/64` —
 * because a typo is the most common reason a message never arrives and the address is the one
 * word on that screen worth reading twice. Splitting the sentence into a "before" key and an
 * "after" key would buy that styling at the cost of word order, which is exactly the thing a
 * translation is entitled to change: Azerbaijani puts the address in a different place in the
 * sentence than English does, and two half-sentences cannot express that.
 *
 * <p>Returns an array, so the caller renders `{fillNodes(...)}` inside its own element. Each
 * part is wrapped in a keyed `Fragment` because React asks for keys on any array of children,
 * and the index is a stable key here: the array is derived from a template that does not
 * change between renders of the same message.
 */
export function fillNodes(
  template: string,
  values: Readonly<Record<string, ReactNode>>,
): readonly ReactNode[] {
  return template.split(/(\{\w+\})/gu).map((part, index) => {
    const name = /^\{(\w+)\}$/u.exec(part)?.[1];
    const value = name === undefined ? part : (values[name] ?? part);

    return createElement(Fragment, { key: index }, value);
  });
}
