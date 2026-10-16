import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../test-copy';
import { moderationCopyFrom } from '../i18n/admin/content-copy';
import type { QueuedReport } from './api';
import {
  DEFAULT_FILTERS,
  OVERDUE_AFTER_MS,
  campaignStateWord,
  formatRelativeTime,
  isOverdue,
  isRefined,
  isRepeated,
  openReportsLabel,
  refine,
  shortId,
  targetParameter,
} from './describe';

const NOW = new Date('2026-08-18T12:00:00.000Z');

function report(overrides: Partial<QueuedReport> = {}): QueuedReport {
  return {
    id: 'r-1',
    target: { type: 'PROJECT', id: 'a1b2c3d4-0000-4000-8000-000000000001' },
    openReportsOnTarget: 1,
    reporterId: 'u1',
    reason: 'FRAUD',
    state: 'OPEN',
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Appearance is reviewed in Storybook. These cover the decisions this module
 * makes on the queue's behalf — what counts as urgent, and what a filter hides.
 */
describe('moderation/describe', () => {
  describe('isOverdue', () => {
    it('calls an open report urgent once it has waited longer than the threshold', () => {
      expect(isOverdue(report({ createdAt: hoursAgo(49) }), NOW)).toBe(true);
      expect(OVERDUE_AFTER_MS).toBe(48 * 60 * 60 * 1000);
    });

    it('leaves a report that has waited less than the threshold alone', () => {
      expect(isOverdue(report({ createdAt: hoursAgo(3) }), NOW)).toBe(false);
    });

    it('never calls a decided report overdue — a finished decision is not late', () => {
      const decided = report({
        createdAt: hoursAgo(500),
        state: 'UPHELD',
        resolution: { moderatorId: 'm-1', at: hoursAgo(400) },
      });

      expect(isOverdue(decided, NOW)).toBe(false);
    });

    it('does not treat an unparseable timestamp as infinitely old', () => {
      expect(isOverdue(report({ createdAt: 'not a date' }), NOW)).toBe(false);
    });
  });

  describe('isRepeated', () => {
    it('is the service’s own triage signal: more than one open complaint', () => {
      expect(isRepeated(report({ openReportsOnTarget: 1 }))).toBe(false);
      expect(isRepeated(report({ openReportsOnTarget: 2 }))).toBe(true);
    });
  });

  describe('openReportsLabel', () => {
    /*
     * The copy is built from `messages/en.json` with the same function the screen calls,
     * rather than typed out here — `src/test-copy.ts` explains at length why a test that
     * retyped the sentence would still pass with the catalogue empty.
     */
    const copy = moderationCopyFrom(translatorFor('admin'), translatorFor('common')('cancel'));

    it('agrees with itself about number and says what the target is', () => {
      expect(openReportsLabel(report({ openReportsOnTarget: 1 }), copy, 'en')).toBe(
        '1 open report on this campaign',
      );
      expect(
        openReportsLabel(
          report({ openReportsOnTarget: 14, target: { type: 'USER', id: 'u9u8u7u6' } }),
          copy,
          'en',
        ),
      ).toBe('14 open reports on this account');
    });
  });

  describe('targetParameter', () => {
    it("turns the chip row's vocabulary into the endpoint's", () => {
      expect(targetParameter('ALL')).toBeNull();
      expect(targetParameter('USER')).toBe('USER');
    });
  });

  describe('refine', () => {
    const campaign = report({ id: 'campaign' });
    const account = report({ id: 'account', target: { type: 'USER', id: 'u9u8u7u6' } });
    const stale = report({ id: 'stale', createdAt: hoursAgo(72) });
    const piledOn = report({ id: 'piled-on', openReportsOnTarget: 9 });
    const all = [campaign, account, stale, piledOn];

    it('hides nothing by default', () => {
      expect(refine(all, DEFAULT_FILTERS, NOW)).toHaveLength(4);
      expect(isRefined(DEFAULT_FILTERS)).toBe(false);
    });

    it('does not narrow by target, because the service does that now', () => {
      // #298 moved `target` across the line from a client-side narrowing to a query
      // parameter. Keeping a copy of the rule here would have been two answers to one
      // question -- and the wrong one would have been the one that filtered a page after
      // the cursor had already moved past what it dropped.
      const untouched = refine(all, { ...DEFAULT_FILTERS, target: 'USER' }, NOW);
      expect(untouched.map((row) => row.id)).toEqual(['campaign', 'account', 'stale', 'piled-on']);
    });

    it('narrows to what has waited too long', () => {
      const only = refine(all, { ...DEFAULT_FILTERS, overdueOnly: true }, NOW);
      expect(only.map((row) => row.id)).toEqual(['stale']);
    });

    it('narrows to targets more than one person has complained about', () => {
      const only = refine(all, { ...DEFAULT_FILTERS, repeatedOnly: true }, NOW);
      expect(only.map((row) => row.id)).toEqual(['piled-on']);
    });

    it('combines the narrowings rather than choosing between them', () => {
      const both = refine(
        [...all, report({ id: 'both', createdAt: hoursAgo(72), openReportsOnTarget: 4 })],
        { ...DEFAULT_FILTERS, overdueOnly: true, repeatedOnly: true },
        NOW,
      );
      expect(both.map((row) => row.id)).toEqual(['both']);
    });

    it('reports that it is hiding something, which is what the count line is for', () => {
      expect(isRefined({ ...DEFAULT_FILTERS, overdueOnly: true })).toBe(true);
      expect(isRefined({ ...DEFAULT_FILTERS, repeatedOnly: true })).toBe(true);
    });

    it('neither server filter counts as hiding something — the service narrowed', () => {
      // A queue narrowed to accounts is not showing three of twenty-five: it asked for
      // accounts and was given accounts, and every page of them is reachable. A
      // "showing 3 of 3" line under a complete list is worse than no line at all.
      expect(isRefined({ ...DEFAULT_FILTERS, state: 'UPHELD' })).toBe(false);
      expect(isRefined({ ...DEFAULT_FILTERS, target: 'PROJECT' })).toBe(false);
    });
  });

  describe('formatRelativeTime', () => {
    it('reads inside a sentence', () => {
      expect(formatRelativeTime(hoursAgo(3), NOW, 'en')).toBe('3 hours ago');
      expect(formatRelativeTime(NOW.toISOString(), NOW, 'en')).toBe('now');
    });

    it('admits it does not know rather than printing "Invalid Date"', () => {
      expect(formatRelativeTime('not a date', NOW, 'en')).toBe('an unknown time ago');
      expect(formatRelativeTime('not a date', NOW, 'ru')).toBe('неизвестно когда');
    });
  });

  describe('campaignStateWord', () => {
    it("names a campaign state in the reader's language, as a fragment of a sentence", () => {
      const az = moderationCopyFrom(translatorFor('admin', 'az'), 'Ləğv et');
      const en = moderationCopyFrom(translatorFor('admin'), 'Cancel');

      expect(campaignStateWord('CHANGES_REQUESTED', az, 'az')).toBe('dəyişiklik tələb olunub');
      expect(campaignStateWord('APPROVED', en, 'en')).toBe('approved');
    });

    it("falls back to the service's own spelling for a state the catalogue does not know", () => {
      const en = moderationCopyFrom(translatorFor('admin'), 'Cancel');

      expect(campaignStateWord('SOMETHING_NEW', en, 'en')).toBe('something new');
    });
  });

  describe('shortId', () => {
    it('gives a card a name it can be told apart by', () => {
      expect(shortId('a1b2c3d4-0000-4000-8000-000000000001')).toBe('a1b2c3d4');
    });
  });
});
