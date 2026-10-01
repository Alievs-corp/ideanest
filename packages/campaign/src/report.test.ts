import { describe, expect, it } from 'vitest';
import en from '@ideanest/messages/en.json';
import { DETAIL_MAX_LENGTH, REPORT_REASONS, reportBody, reportPath, requiresDetail } from './report';

/**
 * §4.9's C-06 and C-07, the half both clients share — #286, shared since #155.
 *
 * The reasons are exactly the catalogue's nine, `OTHER` is the one that needs a sentence and is
 * offered last, each target has its own path, and an empty detail is omitted rather than sent.
 */
describe('the vocabulary', () => {
  it('offers exactly the taxonomy the moderation queue reads back', () => {
    /*
     * One table since #85: the queue and the public dialog both name the nine from
     * `admin.moderation.reason`. This catches a tenth reason reaching the catalogue without
     * reaching the order the dialog offers them in — and the reverse, which is a radio with
     * no label.
     */
    expect([...REPORT_REASONS].sort()).toEqual(Object.keys(en.admin.moderation.reason).sort());
  });

  it('explains every reason to somebody who does not know the taxonomy', () => {
    /*
     * "Not original work" is self-explanatory to a moderator who knows §5.4 and to nobody
     * else, so every reason carries a sentence under it. Read from the catalogue rather than
     * from a constant, because the sentences are in four languages since #85.
     */
    const descriptions: Record<string, string | undefined> = en.moderation.report.descriptions;

    for (const reason of REPORT_REASONS) {
      expect(descriptions[reason], reason).toBeTypeOf('string');
      expect(descriptions[reason]?.trim(), reason).not.toBe('');
    }
  });

  it('ends on “Other”, so the list is read rather than escaped from', () => {
    expect(REPORT_REASONS[REPORT_REASONS.length - 1]).toBe('OTHER');
  });

  it('requires a sentence for “Other” and for nothing else', () => {
    expect(requiresDetail('OTHER')).toBe(true);
    for (const reason of REPORT_REASONS.filter((value) => value !== 'OTHER')) {
      expect(requiresDetail(reason)).toBe(false);
    }
  });
});

describe('the request', () => {
  it('sends each target to its own path, escaped', () => {
    expect(reportPath({ kind: 'campaign', id: 'p1' })).toBe('/v1/projects/p1/report');
    // By slug — #143. The profile carries no account id.
    expect(reportPath({ kind: 'account', slug: 'ayan q' })).toBe('/v1/users/ayan%20q/report');
    expect(reportPath({ kind: 'comment', id: 'c1' })).toBe('/v1/comments/c1/report');
    expect(reportPath({ kind: 'campaign', id: 'p 1/../admin' })).toBe('/v1/projects/p%201%2F..%2Fadmin/report');
  });

  it('omits an empty detail rather than sending an empty string', () => {
    expect(reportBody('FRAUD', '')).toEqual({ reason: 'FRAUD' });
    expect(reportBody('FRAUD', '   \n ')).toEqual({ reason: 'FRAUD' });
  });

  it('trims the detail it does send', () => {
    expect(reportBody('OTHER', '  they posted my address  ')).toEqual({
      reason: 'OTHER',
      detail: 'they posted my address',
    });
  });

  it('caps the detail where the service does', () => {
    expect(DETAIL_MAX_LENGTH).toBe(2000);
  });
});
