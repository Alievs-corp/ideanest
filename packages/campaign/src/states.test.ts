import { describe, expect, it } from 'vitest';
import { RENDERABLE_STATES, isRenderableState } from './states';

/**
 * Which states have a campaign page — the second lock on the door, on both clients (#155). The
 * web turns a state outside the list into a 404 and the app into its not-found screen, so a
 * draft never reaches either.
 */
describe('RENDERABLE_STATES', () => {
  it('is the twelve public states', () => {
    expect([...RENDERABLE_STATES].sort()).toEqual(
      [
        'PRELAUNCH',
        'LIVE',
        'CANCELED',
        'SUCCESSFUL',
        'UNSUCCESSFUL',
        'COLLECTING',
        'LATE_PLEDGE',
        'FULFILLING',
        'COMPLETED',
        'CLOSING_WINDOW',
        'EXTENDED',
        'WITHDRAWN',
      ].sort(),
    );
  });

  it.each(['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED', 'SCHEDULED', 'SUSPENDED'])(
    'has no page for %s',
    (state) => {
      expect(isRenderableState(state)).toBe(false);
    },
  );

  it('has no page for a state this build does not know', () => {
    expect(isRenderableState('ARCHIVED')).toBe(false);
    expect(isRenderableState('')).toBe(false);
  });

  it('has a page for every listed state', () => {
    for (const state of RENDERABLE_STATES) expect(isRenderableState(state)).toBe(true);
  });
});
