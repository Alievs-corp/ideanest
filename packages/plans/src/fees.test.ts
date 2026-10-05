import { describe, expect, it } from 'vitest';
import { disclosureStateOf, readFeeDisclosure } from './fees';

/**
 * §22.3's fee disclosure, narrowed — issue #439.
 *
 * <p>The property under test is the one the whole endpoint exists for: <strong>nothing
 * configured must never become zeros.</strong> The copy this replaced said the platform charges
 * zero commission, which was true only because no schedule is seeded and would have become false
 * the day one was. A client that turned a null rate into `0` would have reintroduced exactly
 * that defect one layer further out.
 */
describe('reading a fee disclosure', () => {
  const configured = {
    configured: true,
    platformRate: '0.05000',
    processingRate: '0.02900',
    processingFixed: '0.3000',
    creatorReceivesRate: '0.92100',
    currency: 'AZN',
    effectiveFrom: '2026-03-01T00:00:00Z',
  };

  it('reads a configured schedule and keeps every rate a string', () => {
    const disclosure = readFeeDisclosure(configured);

    expect(disclosure).toEqual(configured);
    // A JSON number is an IEEE 754 double in every mainstream parser, so a rate that became one
    // here would differ in the last place from the rate the service charges — on the page whose
    // whole purpose is to print the rate the service charges.
    expect(typeof disclosure?.platformRate).toBe('string');
    expect(typeof disclosure?.creatorReceivesRate).toBe('string');
  });

  it('keeps an unconfigured platform unconfigured, and never turns it into zeros', () => {
    const disclosure = readFeeDisclosure({
      configured: false,
      platformRate: null,
      processingRate: null,
      processingFixed: null,
      creatorReceivesRate: null,
      currency: null,
      effectiveFrom: null,
    });

    expect(disclosure?.configured).toBe(false);
    // Nulls. `0` would be a commitment to charge nothing, and an empty table is the platform
    // not having decided.
    expect(disclosure?.platformRate).toBeNull();
    expect(disclosure?.creatorReceivesRate).toBeNull();
  });

  it('refuses a body that does not say whether anything is configured', () => {
    // `configured` is what the component branches on, so a body without it is one the page
    // cannot render a decision from.
    expect(readFeeDisclosure({ platformRate: '0.05000' })).toBeNull();
    expect(readFeeDisclosure(null)).toBeNull();
    expect(readFeeDisclosure('nothing')).toBeNull();
  });
});

/**
 * What a page may say from a disclosure (#145): the unconfigured sentence only for the service's
 * own `configured: false`, and never for a failed read.
 */
describe('what a disclosure lets a page say', () => {
  const rates = {
    configured: true,
    platformRate: '0.05000',
    processingRate: '0.02500',
    processingFixed: null,
    creatorReceivesRate: '0.92500',
    currency: 'AZN',
    effectiveFrom: null,
  };

  it('says "unconfigured" only when the service said so', () => {
    expect(disclosureStateOf({ ...rates, configured: false }, 'creator')).toBe('unconfigured');
    expect(disclosureStateOf({ ...rates, configured: false }, 'backer')).toBe('unconfigured');
  });

  it('treats a failed read as unavailable, never as unconfigured', () => {
    expect(disclosureStateOf(null, 'creator')).toBe('unavailable');
    expect(disclosureStateOf(null, 'backer')).toBe('unavailable');
  });

  it('treats a schedule without its rates as unavailable', () => {
    expect(disclosureStateOf({ ...rates, platformRate: null }, 'backer')).toBe('unavailable');
    expect(disclosureStateOf({ ...rates, processingRate: null }, 'creator')).toBe('unavailable');
    // A creator is told what they keep; a backer is not.
    expect(disclosureStateOf({ ...rates, creatorReceivesRate: null }, 'creator')).toBe('unavailable');
    expect(disclosureStateOf({ ...rates, creatorReceivesRate: null }, 'backer')).toBe('configured');
  });

  it('states the rates when they are all there', () => {
    expect(disclosureStateOf(rates, 'creator')).toBe('configured');
  });
});
