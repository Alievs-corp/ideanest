import { describe, expect, it } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { describeStatus, isFollowableTrackingUrl, type StatusCopy } from './fulfilment';

/**
 * §4.8's PM-09 and PM-10 — moved with the rules from the web's `lib/fulfilment/describe.test.ts`
 * (#159).
 *
 *   - **a tracking URL is a creator's typed text.** `javascript:` followed is script execution.
 *     This is the assertion that keeps that closed.
 *   - every status is paired with words, because a `Tag` variant is colour and colour is never
 *     the only carrier (docs/ui-kit.md §9.2).
 *   - an unknown status renders as itself rather than as a blank or a guess.
 */

const CATALOGUES = { az, en, ru, tr } as const;

function copyOf(catalogue: typeof en): StatusCopy {
  return { status: catalogue.account.fulfilment.status, statusDetail: catalogue.account.fulfilment.statusDetail };
}

const COPY = copyOf(en);
const KNOWN = ['PREPARING', 'SHIPPED', 'DELIVERED', 'RETURNED'] as const;

describe('describeStatus', () => {
  it('gives every known status a label and a sentence, in all four languages', () => {
    for (const catalogue of Object.values(CATALOGUES)) {
      for (const status of KNOWN) {
        const described = describeStatus(status, copyOf(catalogue as typeof en));
        expect(described.label.trim()).not.toBe('');
        expect(described.detail.trim()).not.toBe('');
      }
    }
  });

  it('maps each status to its tone and its catalogue word', () => {
    expect(describeStatus('PREPARING', COPY)).toMatchObject({ label: 'Preparing', tone: 'default' });
    expect(describeStatus('SHIPPED', COPY)).toMatchObject({ label: 'On its way', tone: 'warning' });
    expect(describeStatus('DELIVERED', COPY)).toMatchObject({ label: 'Delivered', tone: 'success' });
    expect(describeStatus('RETURNED', COPY)).toMatchObject({ label: 'Came back', tone: 'danger' });
  });

  it('falls back to the service’s own word for a status this build does not know', () => {
    const described = describeStatus('LOST_IN_TRANSIT', COPY);
    expect(described.label).toBe('LOST_IN_TRANSIT');
    expect(described.detail).toBe(en.account.fulfilment.statusDetail.unknown);
    expect(described.tone).toBe('default');
  });
});

describe('isFollowableTrackingUrl', () => {
  it('allows http and https, whatever their case', () => {
    expect(isFollowableTrackingUrl('https://carrier.example/track/AB123')).toBe(true);
    expect(isFollowableTrackingUrl('http://carrier.example/track/AB123')).toBe(true);
    expect(isFollowableTrackingUrl('HTTPS://carrier.example/track/AB123')).toBe(true);
    expect(isFollowableTrackingUrl('  https://carrier.example/track/AB123  ')).toBe(true);
  });

  it('refuses a scheme that would execute, substitute a document or leave the web', () => {
    expect(isFollowableTrackingUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isFollowableTrackingUrl('JavaScript:alert(1)')).toBe(false);
    expect(isFollowableTrackingUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isFollowableTrackingUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isFollowableTrackingUrl('ftp://carrier.example/track')).toBe(false);
    expect(isFollowableTrackingUrl('intent://scan/#Intent;scheme=zxing;end')).toBe(false);
  });

  it('refuses what is not a URL at all, which is what most tracking numbers are', () => {
    expect(isFollowableTrackingUrl(null)).toBe(false);
    expect(isFollowableTrackingUrl('')).toBe(false);
    expect(isFollowableTrackingUrl('   ')).toBe(false);
    expect(isFollowableTrackingUrl('AB123456789AZ')).toBe(false);
  });
});
