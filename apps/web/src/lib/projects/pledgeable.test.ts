import { describe, expect, it } from 'vitest';
import { PLEDGEABLE_PROJECT_STATES, acceptsPledges } from './pledgeable';
import { PLEDGEABLE_PROJECT_STATES as VIA_STRUCTURED_DATA } from '../seo/structured-data/product';
import type { ProjectState } from './api';

const NOW = new Date('2026-08-19T12:00:00Z');
const OPEN = '2026-08-29T12:00:00Z';

/**
 * Which campaigns may be offered a way to be backed.
 *
 * The interesting cases are all of the form "the state says one thing and the clock says
 * another", because that is where a control gets offered for an action the service refuses —
 * and a refusal a backer meets after pressing a button reads as the site being broken rather
 * than as the campaign being over.
 */
describe('acceptsPledges', () => {
  it('offers a live campaign whose deadline has not passed', () => {
    expect(acceptsPledges('LIVE', OPEN, NOW)).toBe(true);
  });

  /**
   * §8.4's finalizer runs every minute; `PledgeAcceptance` calls refusing this "the difference
   * between a deadline and a suggestion". The page must not offer what the service will refuse.
   */
  it('refuses a live campaign whose deadline has passed but which has not been finalised', () => {
    expect(acceptsPledges('LIVE', '2026-08-19T11:59:59Z', NOW)).toBe(false);
  });

  it('treats the deadline instant itself as closed, the way the service does', () => {
    expect(acceptsPledges('LIVE', NOW.toISOString(), NOW)).toBe(false);
  });

  /**
   * IDN-EXT-01 (#36): the seven days after the first deadline and an extension both still take
   * pledges, and both are past the first deadline by definition. Whether they are still open is
   * the window's or the extension's end, which the public projection does not carry.
   */
  it.each<ProjectState>(['CLOSING_WINDOW', 'EXTENDED'])(
    'offers a %s campaign despite its first deadline having passed',
    (state) => {
      expect(acceptsPledges(state, '2026-08-15T12:00:00Z', NOW)).toBe(true);
    },
  );

  it.each<ProjectState>([
    'PRELAUNCH',
    'SUCCESSFUL',
    'UNSUCCESSFUL',
    'COLLECTING',
    'LATE_PLEDGE',
    'WITHDRAWN',
    'FULFILLING',
    'COMPLETED',
    'CANCELED',
  ])('refuses %s, which is public and closed', (state) => {
    expect(acceptsPledges(state, OPEN, NOW)).toBe(false);
  });

  /**
   * A missing or malformed deadline does not hide the primary action on a live campaign. The
   * opposite default turns one bad string into a silent outage of the only thing the page is
   * for, and the checkout still refuses the pledge if the service disagrees.
   */
  it.each([null, '', 'not a date'])('offers a live campaign whose deadline is %p', (deadline) => {
    expect(acceptsPledges('LIVE', deadline, NOW)).toBe(true);
  });
});

describe('PLEDGEABLE_PROJECT_STATES', () => {
  it('is the three states in which a pledge can be taken', () => {
    expect([...PLEDGEABLE_PROJECT_STATES]).toEqual(['LIVE', 'CLOSING_WINDOW', 'EXTENDED']);
  });

  /**
   * ONE LIST, NOT TWO THAT AGREE TODAY. The structured data tells a crawler a tier is on
   * offer and this page draws the control that takes the offer; a second frozen array would
   * let the markup and the button disagree the first time §6.1 gains a state.
   */
  it('is the same list the structured data offers tiers from', () => {
    expect(VIA_STRUCTURED_DATA).toBe(PLEDGEABLE_PROJECT_STATES);
  });
});
