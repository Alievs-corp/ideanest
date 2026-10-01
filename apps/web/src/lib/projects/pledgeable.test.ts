import { describe, expect, it } from 'vitest';
import { PLEDGEABLE_PROJECT_STATES as SHARED } from '@ideanest/campaign/pledgeable';
import { PLEDGEABLE_PROJECT_STATES } from './pledgeable';
import { PLEDGEABLE_PROJECT_STATES as VIA_STRUCTURED_DATA } from '../seo/structured-data/product';

/*
 * `acceptsPledges` is tested where it lives, in `packages/campaign` (#155). What is left here is
 * the web's own promise: the list this page offers pledges for, the list its structured data
 * offers tiers from, and the list the app reads are one array and not three that agree today.
 */
describe('PLEDGEABLE_PROJECT_STATES', () => {
  it('is the shared list, re-exported rather than restated', () => {
    expect(PLEDGEABLE_PROJECT_STATES).toBe(SHARED);
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
