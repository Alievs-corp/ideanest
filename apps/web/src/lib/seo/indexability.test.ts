import { describe, expect, it } from 'vitest';

import {
  HIDDEN_PROJECT_STATES,
  INDEXABLE_PROJECT_STATES,
  PRIVATE_PATH_PREFIXES,
  PROJECT_STATE_INDEXABILITY,
  isIndexableProjectState,
  projectPageRobots,
  projectStateIndexability,
} from './indexability';

/**
 * The one predicate, and the sixteen states of docs/architecture.md §6.1 it is
 * an answer about.
 *
 * These are the tests that stop a draft campaign becoming a search result, so
 * they name every state rather than sampling. A seventeenth state added to §6.1
 * fails the partition test below rather than quietly defaulting to indexable.
 */

const ALL_STATES = [
  'DRAFT',
  'PRELAUNCH',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'LIVE',
  'CLOSING_WINDOW',
  'EXTENDED',
  'SUSPENDED',
  'CANCELED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'WITHDRAWN',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
] as const;

describe('the state table', () => {
  it('answers for exactly the nineteen states of §6.1', () => {
    expect(Object.keys(PROJECT_STATE_INDEXABILITY).sort()).toEqual([...ALL_STATES].sort());
  });

  it('partitions them — every state is answered exactly once', () => {
    for (const state of ALL_STATES) {
      expect(PROJECT_STATE_INDEXABILITY[state]).toMatch(
        /^(INDEXABLE|PUBLIC_NOT_INDEXABLE|NOT_PUBLIC)$/,
      );
    }
  });

  it('marks the seven states discovery never returns as not public', () => {
    // The service states the same set independently — DiscoveryStatus.HIDDEN_STATES.
    expect([...HIDDEN_PROJECT_STATES].sort()).toEqual(
      ['APPROVED', 'CHANGES_REQUESTED', 'DRAFT', 'REJECTED', 'SCHEDULED', 'SUBMITTED', 'SUSPENDED'],
    );

    for (const state of HIDDEN_PROJECT_STATES) {
      expect(projectStateIndexability(state)).toBe('NOT_PUBLIC');
    }
  });
});

describe('isIndexableProjectState', () => {
  it('admits a campaign whose public page has been moderated and is stable', () => {
    expect(isIndexableProjectState('LIVE')).toBe(true);
    expect(isIndexableProjectState('LATE_PLEDGE')).toBe(true);
    expect(isIndexableProjectState('SUCCESSFUL')).toBe(true);
    expect(isIndexableProjectState('COLLECTING')).toBe(true);
    expect(isIndexableProjectState('FULFILLING')).toBe(true);
    expect(isIndexableProjectState('COMPLETED')).toBe(true);
    expect(isIndexableProjectState('UNSUCCESSFUL')).toBe(true);
  });

  it('refuses a draft, a campaign under review, and a rejected one', () => {
    expect(isIndexableProjectState('DRAFT')).toBe(false);
    expect(isIndexableProjectState('SUBMITTED')).toBe(false);
    expect(isIndexableProjectState('CHANGES_REQUESTED')).toBe(false);
    expect(isIndexableProjectState('REJECTED')).toBe(false);
    expect(isIndexableProjectState('APPROVED')).toBe(false);
    expect(isIndexableProjectState('SCHEDULED')).toBe(false);
  });

  it('refuses a suspended campaign', () => {
    expect(isIndexableProjectState('SUSPENDED')).toBe(false);
  });

  it('refuses a cancelled campaign even though its page is publicly reachable', () => {
    expect(projectStateIndexability('CANCELED')).toBe('PUBLIC_NOT_INDEXABLE');
    expect(isIndexableProjectState('CANCELED')).toBe(false);
  });

  it('refuses a pre-launch campaign, which is a teaser and has not been moderated', () => {
    expect(projectStateIndexability('PRELAUNCH')).toBe('PUBLIC_NOT_INDEXABLE');
    expect(isIndexableProjectState('PRELAUNCH')).toBe(false);
  });

  it('fails closed on a state it has never heard of', () => {
    expect(projectStateIndexability('ARCHIVED')).toBe('NOT_PUBLIC');
    expect(isIndexableProjectState('')).toBe(false);
    expect(isIndexableProjectState('live')).toBe(false);
  });

  it('agrees with the exported list of indexable states', () => {
    for (const state of ALL_STATES) {
      expect(INDEXABLE_PROJECT_STATES.includes(state)).toBe(isIndexableProjectState(state));
    }
  });
});

describe('projectPageRobots', () => {
  it('lets a crawler index an indexable campaign', () => {
    expect(projectPageRobots('LIVE')).toEqual({ index: true, follow: true });
  });

  it('withholds the index but not the links for everything else', () => {
    // `follow` stays true: a cancelled campaign still links to its creator and
    // its category, and those pages are indexable.
    expect(projectPageRobots('CANCELED')).toEqual({ index: false, follow: true });
    expect(projectPageRobots('DRAFT')).toEqual({ index: false, follow: true });
  });
});

describe('PRIVATE_PATH_PREFIXES', () => {
  it('covers the pledge flow, the editor, the account, and the dashboard', () => {
    const covered = (path: string) => PRIVATE_PATH_PREFIXES.some((prefix) => prefix === path);

    expect(covered('/projects/*/back')).toBe(true);
    expect(covered('/projects/new')).toBe(true);
    expect(covered('/projects/*/edit')).toBe(true);
    expect(covered('/projects/*/prelaunch')).toBe(true);
    expect(covered('/settings')).toBe(true);
    expect(covered('/dashboard')).toBe(true);
    expect(covered('/admin')).toBe(true);
    expect(covered('/v1/')).toBe(true);
  });

  it('never disallows a public surface', () => {
    expect(PRIVATE_PATH_PREFIXES).not.toContain('/');
    expect(PRIVATE_PATH_PREFIXES).not.toContain('/discover');
    expect(PRIVATE_PATH_PREFIXES).not.toContain('/projects');
  });
});
