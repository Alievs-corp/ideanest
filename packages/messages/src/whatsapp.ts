/**
 * The WhatsApp enquiry: the number, the text, and the link that hands both over.
 *
 * <h2>What actually delivers the message, and what does not</h2>
 *
 * **This module sends nothing.** `wa.me` is a deep link: it opens WhatsApp — the app on a
 * phone, `web.whatsapp.com` on a desktop — with the conversation and a draft already filled
 * in, and the visitor presses send themselves. That last press is not friction to be designed
 * away, it is the whole mechanism:
 *
 *   - The message arrives **from the visitor's own number**, so the reply goes back to a
 *     person rather than into a form nobody owns.
 *   - It needs no credential. Sending on the platform's behalf means the WhatsApp Business
 *     Cloud API, a Meta application, a permanent token and a template approved in advance for
 *     any message a business starts. None of that exists here, and a form that pretended to
 *     send while silently dropping the text is worse than one that is honest about the handoff.
 *
 * So the copy says that WhatsApp opens and the visitor presses send, and
 * `WhatsAppLauncher` keeps the link on screen afterwards rather than claiming delivery.
 *
 * <h2>The number is digits, with no `+`</h2>
 *
 * `wa.me` takes an international number as digits only — no plus, no spaces, no dashes. The
 * displayed form (`+421 952 480 349`) is built from this one for the reader, so the two cannot
 * drift apart, and `whatsapp.test.ts` pins the shape.
 */

/** The destination, in the form `wa.me` requires: E.164 digits without the leading `+`. */
export const WHATSAPP_CONTACT_NUMBER = '421952480349';

/**
 * How long a message may be.
 *
 * The deep link carries the text in a query parameter, and a URL is not an unbounded place to
 * put one: browsers and the WhatsApp handler both stop reading somewhere past a couple of
 * thousand characters, and where they stop is neither specified nor the same. A cap the field
 * enforces means the reader is told before they type a message that would arrive cut in half.
 */
export const MESSAGE_MAX_LENGTH = 900;

export interface WhatsAppEnquiry {
  readonly firstName: string;
  readonly lastName: string;
  readonly message: string;
}

/** The three fields, in the order the form draws them. */
export const ENQUIRY_FIELDS = ['firstName', 'lastName', 'message'] as const;

export type EnquiryField = (typeof ENQUIRY_FIELDS)[number];

/**
 * The fields that are still empty, in form order.
 *
 * Whitespace counts as empty: a space bar pressed in a required field is not a name, and
 * `trim` here is what stops a message arriving signed by nobody.
 */
export function missingFields(enquiry: WhatsAppEnquiry): readonly EnquiryField[] {
  return ENQUIRY_FIELDS.filter((field) => enquiry[field].trim() === '');
}

/**
 * The text WhatsApp opens with.
 *
 * The name on its own line and the message below it, and **not a word of boilerplate** —
 * no "Hello, my name is". Whatever this module wrote would be written in one language and
 * read in four, and the platform already knows who it is: the sentence a visitor wants is
 * the one they typed.
 *
 * Interior whitespace inside the message is left exactly as it was typed. Somebody who
 * wrote a list of three questions on three lines gets three lines.
 */
export function composeEnquiry(enquiry: WhatsAppEnquiry): string {
  const name = `${enquiry.firstName.trim()} ${enquiry.lastName.trim()}`.trim();
  return `${name}\n\n${enquiry.message.trim()}`;
}

/**
 * The deep link, with the composed text as its `text` parameter.
 *
 * `encodeURIComponent` rather than `URLSearchParams`, which encodes a space as `+`: the
 * WhatsApp handler renders that literally, so a two-word name arrives as `Aysel+Mammadova`.
 * `%20` is what the draft has to carry.
 */
export function whatsappHref(enquiry: WhatsAppEnquiry): string {
  const text = encodeURIComponent(composeEnquiry(enquiry));
  return `https://wa.me/${WHATSAPP_CONTACT_NUMBER}?text=${text}`;
}
