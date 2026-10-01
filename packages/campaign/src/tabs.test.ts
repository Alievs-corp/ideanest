import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_CURSOR_PARAM,
  CAMPAIGN_TAB_PARAM,
  CAMPAIGN_TABS,
  CAMPAIGN_THREAD_PARAM,
  DEFAULT_CAMPAIGN_TAB,
  campaignCursorFrom,
  campaignTabFrom,
} from './tabs';

/**
 * The campaign page's tabs, as addresses — #282, #284, #285.
 *
 * WHAT THESE COVER, and why each one is worth a test rather than a comment:
 *
 *   - **the default tab has exactly one address.** `?tab=campaign` and the bare path are the
 *     same page, and the moment this module produces both, the canonical URL, the sitemap
 *     entry and the link somebody pastes into a message become three strings for one
 *     campaign.
 *   - **an unknown tab is the campaign, never a refusal.** A mistyped query parameter must
 *     not be able to take a real campaign off the internet.
 *   - **a repeated parameter does not silently take the wrong branch.** Next hands
 *     `?tab=a&tab=b` over as an array, and a reader that assumed a string would compare an
 *     array with a string and land on the default without anybody noticing which one was
 *     meant.
 *   - **the cursor is carried, not interpreted.** An update cursor is an integer and a
 *     comment cursor is a UUID; this module is told to read neither, and the test is what
 *     stops somebody adding a "sensible" format check that refuses the next encoding.
 *   - **the FAQ tab exists, is fifth, and sits where §4.4's table puts it (#283).** It was
 *     the one tab of the table left out of the four above, because nothing on the platform
 *     stored a question and a tab that always said "no questions yet" would have been a claim
 *     about every campaign rather than about the software. `project_faqs` exists now. The
 *     position is tested rather than commented because it is the reading order: the answers a
 *     creator has already written are what a reader with a question should meet before the
 *     comment box.
 */

describe('reading the tab from the address', () => {
  it('answers the default for an absent parameter', () => {
    expect(campaignTabFrom(undefined)).toBe('campaign');
  });

  it('answers the default rather than refusing an unknown tab', () => {
    expect(campaignTabFrom('nonsense')).toBe('campaign');
  });

  it('reads each tab it publishes', () => {
    for (const tab of CAMPAIGN_TABS) {
      expect(campaignTabFrom(tab.id)).toBe(tab.id);
    }
  });

  it('is not case sensitive, because a link is typed by people', () => {
    expect(campaignTabFrom('Comments')).toBe('comments');
  });

  it('takes the first of a repeated parameter rather than refusing the page', () => {
    expect(campaignTabFrom(['updates', 'comments'])).toBe('updates');
  });

  /** #283. The tab that had no endpoint until the service published one. */
  it('resolves ?tab=faq', () => {
    expect(campaignTabFrom('faq')).toBe('faq');
    expect(campaignTabFrom('FAQ')).toBe('faq');
  });
});

describe('which tabs the page publishes', () => {
  it('lists FAQ after Creator and before Updates, where §4.4 puts it', () => {
    expect(CAMPAIGN_TABS.map((tab) => tab.id)).toEqual([
      'campaign',
      'creator',
      'faq',
      'updates',
      'comments',
    ]);
  });

  /**
   * §4.4's table has seven rows. Rewards is the column beside the story rather than a tab,
   * and Community is blocked on #209 — a backer-statistics bucket below a minimum cell size
   * identifies the person in it, and the minimum is a product and legal answer.
   */
  it('publishes neither Rewards nor Community, and the module says why', () => {
    const ids = CAMPAIGN_TABS.map((tab) => tab.id);
    expect(ids).not.toContain('rewards');
    expect(ids).not.toContain('community');
  });
});

describe('reading a cursor from the address', () => {
  it('passes an opaque value through untouched', () => {
    expect(campaignCursorFrom('0193f2a1-0000-7000-8000-000000000001')).toBe(
      '0193f2a1-0000-7000-8000-000000000001',
    );
  });

  it('accepts an integer cursor, which is what an update page uses', () => {
    expect(campaignCursorFrom('7')).toBe('7');
  });

  it('answers null for an absent or empty parameter', () => {
    expect(campaignCursorFrom(undefined)).toBeNull();
    expect(campaignCursorFrom('   ')).toBeNull();
  });

  /**
   * A bound rather than a format. The point is not to validate the encoding — this module is
   * told not to read it — but to refuse to put a kilobyte of somebody else's query string
   * into an outbound request to the service.
   */
  it('refuses a value longer than any cursor the service mints', () => {
    expect(campaignCursorFrom('x'.repeat(129))).toBeNull();
    expect(campaignCursorFrom('x'.repeat(128))).toBe('x'.repeat(128));
  });
});

/**
 * #155: the app reads the same parameters from a deep link (`?tab=comments&thread=c1`), so the
 * names are part of the contract between a shared link and both clients.
 */
describe('the parameter names', () => {
  it('are tab, from and thread, and the default tab is campaign', () => {
    expect([CAMPAIGN_TAB_PARAM, CAMPAIGN_CURSOR_PARAM, CAMPAIGN_THREAD_PARAM]).toEqual([
      'tab',
      'from',
      'thread',
    ]);
    expect(DEFAULT_CAMPAIGN_TAB).toBe('campaign');
  });
});
