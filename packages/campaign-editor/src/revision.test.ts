import { describe, expect, it } from 'vitest';
import type { ProjectEdit } from './contract';
import { isRevisionField, revisionRefusalOf, revisionView } from './revision';

const BASE: ProjectEdit = {
  id: 'p1',
  slug: 'a-recorder',
  state: 'LIVE',
  title: 'A recorder',
  lockedFields: ['goal'],
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-02T09:00:00Z',
};

const revision = (status: 'DRAFT' | 'PENDING', changedFields: readonly string[]) => ({
  id: 'r1',
  status,
  changedFields,
  submittedAt: status === 'PENDING' ? '2026-10-03T09:00:00Z' : null,
  updatedAt: '2026-10-03T09:00:00Z',
});

describe('revisionView', () => {
  it('has nothing to show or do without an edit', () => {
    expect(revisionView(BASE)).toEqual({
      kind: 'none',
      changedFields: [],
      reason: null,
      canSubmit: false,
      canDiscard: false,
    });
    expect(revisionView(null).kind).toBe('none');
    expect(revisionView({ ...BASE, revision: null, rejectedRevision: null }).kind).toBe('none');
  });

  it('lets a draft with changes be sent or discarded', () => {
    const view = revisionView({ ...BASE, revision: revision('DRAFT', ['title', 'story']) });
    expect(view).toMatchObject({
      kind: 'draft',
      changedFields: ['title', 'story'],
      canSubmit: true,
      canDiscard: true,
    });
  });

  it('does not offer to send a draft that changes nothing', () => {
    expect(revisionView({ ...BASE, revision: revision('DRAFT', []) }).canSubmit).toBe(false);
  });

  it('lets a pending edit be discarded but not sent again', () => {
    const view = revisionView({ ...BASE, revision: revision('PENDING', ['blurb']) });
    expect(view).toMatchObject({ kind: 'pending', canSubmit: false, canDiscard: true });
  });

  it('carries the moderator reason when the last edit was rejected', () => {
    const view = revisionView({
      ...BASE,
      rejectedRevision: { id: 'r0', reason: 'The cover shows another brand.', decidedAt: '2026-10-04T09:00:00Z' },
    });
    expect(view).toMatchObject({
      kind: 'rejected',
      reason: 'The cover shows another brand.',
      canSubmit: false,
      canDiscard: false,
    });
  });

  it('prefers an open edit over an older rejection', () => {
    const view = revisionView({
      ...BASE,
      revision: revision('DRAFT', ['risks']),
      rejectedRevision: { id: 'r0', reason: 'No.', decidedAt: '2026-10-04T09:00:00Z' },
    });
    expect(view.kind).toBe('draft');
    expect(view.reason).toBeNull();
  });
});

describe('revisionRefusalOf', () => {
  it('reads the four reasons the server gives', () => {
    for (const reason of ['NO_OPEN_REVISION', 'ALREADY_SUBMITTED', 'NO_CHANGES', 'NOT_PENDING']) {
      expect(revisionRefusalOf({ reason })).toBe(reason);
    }
  });

  it('falls back for anything else', () => {
    expect(revisionRefusalOf({ reason: 'SOMETHING_NEW' })).toBe('UNKNOWN');
    expect(revisionRefusalOf(undefined)).toBe('UNKNOWN');
    expect(revisionRefusalOf(null)).toBe('UNKNOWN');
  });
});

describe('isRevisionField', () => {
  it('knows the sections an edit can change', () => {
    expect(isRevisionField('coverImage')).toBe(true);
    expect(isRevisionField('rewards')).toBe(true);
    expect(isRevisionField('goal')).toBe(false);
  });
});
