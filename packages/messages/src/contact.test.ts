import { describe, expect, it } from 'vitest';
import { SUPPORT_EMAIL, SUPPORT_PHONE, displayPhone, supportMailto } from './contact';

/**
 * The support details — issue #325. They are what the published privacy policy states, so the
 * shapes are pinned: a `tel:` link that dials nothing, or a subject a mail client mangles, fails
 * without anybody seeing it fail.
 */
describe('the support contact', () => {
  it('stores the phone as E.164, which is what a tel: link dials', () => {
    expect(SUPPORT_PHONE).toMatch(/^\+\d{8,15}$/u);
  });

  it('shows an Azerbaijani number grouped the way it is read aloud', () => {
    expect(displayPhone(SUPPORT_PHONE)).toBe('+994 51 700 35 00');
  });

  it('shows any other shape as stored rather than grouping it wrongly', () => {
    expect(displayPhone('+421952480349')).toBe('+421952480349');
  });

  it('writes a mailto link, with the subject encoded so a space stays a space', () => {
    expect(supportMailto()).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(supportMailto('Delete my account')).toBe(
      `mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`,
    );
    expect(supportMailto('Hesabımı silin')).toBe(
      `mailto:${SUPPORT_EMAIL}?subject=Hesab%C4%B1m%C4%B1%20silin`,
    );
  });
});
