import { describe, expect, it } from 'vitest';
import { campaignTabHref } from './tabs';

/**
 * The campaign page's tabs, as addresses — #282, #284, #285.
 *
 * Reading a tab or a cursor out of the address is `packages/campaign/src/tabs.test.ts` since
 * #155; building the web's own href is tested here.
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

const PATH = '/projects/ayan/coffee-table-book';

describe('building a tab address', () => {
  it('gives the default tab the bare path and no parameter', () => {
    expect(campaignTabHref(PATH, 'campaign')).toBe(PATH);
  });

  it('names every other tab in the query string', () => {
    expect(campaignTabHref(PATH, 'comments')).toBe(`${PATH}?tab=comments`);
    expect(campaignTabHref(PATH, 'faq')).toBe(`${PATH}?tab=faq`);
  });

  it('carries a cursor beside the tab', () => {
    expect(campaignTabHref(PATH, 'updates', { cursor: '7' })).toBe(`${PATH}?tab=updates&from=7`);
  });

  it('carries a thread identifier, which is what "show more replies" links to', () => {
    expect(campaignTabHref(PATH, 'comments', { thread: 'abc' })).toBe(
      `${PATH}?tab=comments&thread=abc`,
    );
  });

  it('drops an empty cursor rather than sending the service an empty parameter', () => {
    expect(campaignTabHref(PATH, 'updates', { cursor: '' })).toBe(`${PATH}?tab=updates`);
    expect(campaignTabHref(PATH, 'updates', { cursor: null })).toBe(`${PATH}?tab=updates`);
  });
});

