import { describe, expect, it } from 'vitest';
import {
  MESSAGE_MAX_LENGTH,
  WHATSAPP_CONTACT_NUMBER,
  composeEnquiry,
  missingFields,
  whatsappHref,
} from './whatsapp';

/**
 * The deep link, which is the one part of this feature that cannot be checked by looking at it.
 *
 * A malformed `wa.me` URL does not fail loudly. WhatsApp opens on a blank conversation, or on
 * the wrong number, or with a draft carrying `+` where the spaces were — and every one of
 * those looks like a working button to whoever pressed it.
 */
describe('the WhatsApp enquiry link', () => {
  const ENQUIRY = { firstName: 'Aysel', lastName: 'Mammadova', message: 'Salam!' };

  it('carries the number as digits, which is the only form wa.me reads', () => {
    /* A `+`, a space or a dash here resolves to a conversation with nobody. */
    expect(WHATSAPP_CONTACT_NUMBER).toMatch(/^\d{8,15}$/u);
    expect(WHATSAPP_CONTACT_NUMBER).toBe('421952480349');
  });

  it('points at that number', () => {
    expect(whatsappHref(ENQUIRY)).toContain(`https://wa.me/${WHATSAPP_CONTACT_NUMBER}?text=`);
  });

  it('puts the name above the message and adds no boilerplate of its own', () => {
    expect(composeEnquiry(ENQUIRY)).toBe('Aysel Mammadova\n\nSalam!');
  });

  it('keeps the line breaks somebody typed', () => {
    expect(composeEnquiry({ ...ENQUIRY, message: 'One\nTwo' })).toBe(
      'Aysel Mammadova\n\nOne\nTwo',
    );
  });

  it('trims each field, so a stray space is never part of a name', () => {
    expect(composeEnquiry({ firstName: ' Aysel ', lastName: ' Mammadova ', message: ' Salam! ' })).toBe(
      'Aysel Mammadova\n\nSalam!',
    );
  });

  it('encodes a space as %20 and never as +, which WhatsApp would render literally', () => {
    const href = whatsappHref(ENQUIRY);
    expect(href).toContain('Aysel%20Mammadova');
    expect(href).not.toContain('+');
  });

  it('encodes the characters that would otherwise end the query or start a second parameter', () => {
    const href = whatsappHref({ ...ENQUIRY, message: 'a&b=c #1 100%' });
    expect(href).not.toMatch(/[&#]/u);
    expect(new URL(href).searchParams.get('text')).toBe('Aysel Mammadova\n\na&b=c #1 100%');
  });

  it('encodes the alphabets the site is read in', () => {
    /* Azerbaijani and Russian both leave the ASCII range, and a draft that arrives as
     * mojibake is a message the recipient cannot read. */
    const href = whatsappHref({ firstName: 'Əli', lastName: 'Şəkərov', message: 'Здравствуйте' });
    expect(new URL(href).searchParams.get('text')).toBe('Əli Şəkərov\n\nЗдравствуйте');
  });

  it('names every empty field, in the order the form draws them', () => {
    expect(missingFields({ firstName: '', lastName: '', message: '' })).toEqual([
      'firstName',
      'lastName',
      'message',
    ]);
  });

  it('counts whitespace as empty, so a message cannot arrive signed by nobody', () => {
    expect(missingFields({ firstName: '   ', lastName: '\t', message: '\n' })).toEqual([
      'firstName',
      'lastName',
      'message',
    ]);
  });

  it('names nothing when all three are filled in', () => {
    expect(missingFields(ENQUIRY)).toEqual([]);
  });

  it('keeps the whole link inside the length a URL survives', () => {
    /* The cap exists because the handler stops reading somewhere past a couple of thousand
     * characters and does not say where. This is the worst case: a full message of characters
     * that each encode to three bytes. */
    const href = whatsappHref({
      firstName: 'Ə'.repeat(40),
      lastName: 'Ş'.repeat(40),
      message: 'ю'.repeat(MESSAGE_MAX_LENGTH),
    });
    expect(href.length).toBeLessThan(8000);
  });
});
