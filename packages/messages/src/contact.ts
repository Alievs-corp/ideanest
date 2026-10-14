/**
 * How to reach the people who run IdeyaNest: the support address, the phone number and the
 * operator's name — issue #325.
 *
 * <h2>Why here, beside the WhatsApp number</h2>
 *
 * These are the details the published privacy policy states (§2.2 and its footer line), and
 * they are needed in three places: the web's `/support` page, the app, and the store listings
 * that point at that page. The WhatsApp number already lives in this package for the same
 * reason — one value both applications read — so the rest of the contact details sit next to
 * it rather than as literals in a page. When the operator changes an address, it changes here
 * and in the policy, and nowhere else.
 *
 * <h2>Not in the catalogue</h2>
 *
 * An address is not a translation. Four copies of it in four catalogues is four places for one
 * of them to be left behind, so the sentences around these values are catalogue strings with a
 * placeholder and the values are filled in from here.
 */

/** Where every question, privacy request and no-sign-in deletion request goes. */
export const SUPPORT_EMAIL = 'alievsteams@gmail.com';

/** The support line, E.164: what a `tel:` link dials. */
export const SUPPORT_PHONE = '+994517003500';

/** The company that operates the platform, as the privacy policy names it. */
export const OPERATOR_NAME = 'Alievs Space MMC';

/**
 * The support line as a reader reads it: `+994 51 700 35 00`.
 *
 * Built from `SUPPORT_PHONE` rather than written twice, so the number dialled and the number
 * shown cannot drift apart. Azerbaijani numbers group as country, operator, then 3-2-2; any
 * other shape is shown as it is stored rather than grouped wrongly.
 */
export function displayPhone(e164: string = SUPPORT_PHONE): string {
  const azerbaijani = /^\+994(\d{2})(\d{3})(\d{2})(\d{2})$/u.exec(e164);
  if (azerbaijani === null) return e164;
  const [, operator, first, second, third] = azerbaijani;
  return `+994 ${operator} ${first} ${second} ${third}`;
}

/**
 * A `mailto:` link to support, with the subject filled in when there is one.
 *
 * `encodeURIComponent` rather than `URLSearchParams`: the latter writes a space as `+`, which a
 * mail client puts in the subject line literally.
 */
export function supportMailto(subject?: string): string {
  const query = subject === undefined ? '' : `?subject=${encodeURIComponent(subject)}`;
  return `mailto:${SUPPORT_EMAIL}${query}`;
}
