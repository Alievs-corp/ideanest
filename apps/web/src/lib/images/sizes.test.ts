import { describe, expect, it } from 'vitest';
import { CAMPAIGN_GRID, PROFILE_CAMPAIGN_GRID } from '../../components/browse/campaign-grid-layout';
import {
  CAMPAIGN_CARD_SIZES,
  COLLECTION_CARD_SIZES,
  PRELAUNCH_COVER_SIZES,
  PROFILE_CARD_SIZES,
  sizesFor,
} from './sizes';

/**
 * `sizes` decides how many bytes every visitor downloads and it is checked by
 * nobody at runtime — a wrong one renders perfectly and costs four times the
 * bandwidth. These tests are the only place the derivation is verified.
 */

describe('sizesFor', () => {
  it('writes the conditions in source order', () => {
    expect(
      sizesFor([
        { minWidth: 1024, size: '400px' },
        { minWidth: 640, size: '50vw' },
        { size: '100vw' },
      ]),
    ).toBe('(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw');
  });

  it('refuses stops that ascend', () => {
    // The browser takes the FIRST matching condition, not the most specific, so
    // a narrow stop written before a wide one makes the wide one dead code.
    expect(() =>
      sizesFor([
        { minWidth: 640, size: '50vw' },
        { minWidth: 1024, size: '400px' },
        { size: '100vw' },
      ]),
    ).toThrow(/descend/);
  });

  it('refuses two stops at the same breakpoint', () => {
    expect(() =>
      sizesFor([
        { minWidth: 640, size: '50vw' },
        { minWidth: 640, size: '60vw' },
        { size: '100vw' },
      ]),
    ).toThrow(/descend/);
  });

  it('refuses a list with no fallback', () => {
    // Without it, every viewport below the narrowest breakpoint is told
    // nothing and the browser falls back to 100vw.
    expect(() => sizesFor([{ minWidth: 640, size: '50vw' }])).toThrow(/fallback/);
  });

  it('refuses a fallback anywhere but last', () => {
    expect(() =>
      sizesFor([{ size: '100vw' }, { minWidth: 640, size: '50vw' }]),
    ).toThrow(/minWidth/);
  });

  it('refuses an empty list', () => {
    expect(() => sizesFor([])).toThrow();
  });
});

/**
 * The layouts, as they are written today. If one of these fails, a grid or a
 * column changed and the `sizes` beside it did not — which is the exact drift
 * this file exists to catch.
 */
describe('the derived attributes', () => {
  it('describes the campaign grid', () => {
    // max-w-[1400px] px-5 sm:px-6, then CAMPAIGN_GRID: 85% of that, gap-4, 1 → 2 → 3 columns.
    for (const token of ['max-w-[85%]', 'grid-cols-1', 'gap-4', 'sm:grid-cols-2', 'xl:grid-cols-3']) {
      expect(CAMPAIGN_GRID.split(' ')).toContain(token);
    }
    expect(CAMPAIGN_CARD_SIZES).toBe(
      '(min-width: 1400px) 373px, ' +
        '(min-width: 1280px) calc((85vw - 72px) / 3), ' +
        '(min-width: 640px) calc(42.5vw - 28px), ' +
        'calc(85vw - 34px)',
    );
  });

  it('describes the profile campaign grid', () => {
    // max-w-[1120px] px-5 sm:px-6, then PROFILE_CAMPAIGN_GRID: 85%, gap-4, 1 → 2 → 3 at lg.
    for (const token of ['max-w-[85%]', 'grid-cols-1', 'gap-4', 'sm:grid-cols-2', 'lg:grid-cols-3']) {
      expect(PROFILE_CAMPAIGN_GRID.split(' ')).toContain(token);
    }
    expect(PROFILE_CARD_SIZES).toBe(
      '(min-width: 1168px) 294px, ' +
        '(min-width: 1024px) calc((85vw - 72px) / 3), ' +
        '(min-width: 640px) calc(42.5vw - 28px), ' +
        'calc(85vw - 34px)',
    );
  });

  it('describes the collection index grid', () => {
    // max-w-[1400px] px-5 sm:px-6, grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3
    expect(COLLECTION_CARD_SIZES).toBe(
      '(min-width: 1400px) 440px, ' +
        '(min-width: 1280px) calc((100vw - 80px) / 3), ' +
        '(min-width: 640px) calc(50vw - 32px), ' +
        'calc(100vw - 40px)',
    );
  });

  it('describes the prelaunch column', () => {
    // max-w-[720px] px-5 sm:px-6 — fixed once the viewport holds 720 + 48.
    expect(PRELAUNCH_COVER_SIZES).toBe(
      '(min-width: 768px) 720px, (min-width: 640px) calc(100vw - 48px), calc(100vw - 40px)',
    );
  });
});
