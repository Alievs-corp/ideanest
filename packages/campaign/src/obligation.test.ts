import { describe, expect, it } from 'vitest';
import { readCreatorObligations, readUpdateObligation } from './obligation';

/**
 * The narrowing behind §5.5's state — issue #437.
 *
 * <p>These reads go through a plain `fetch`, so nothing type-checks them against the service.
 * `#323`'s argument applies in full: the narrowing is the type check, and a test of the
 * narrowing is what stands in for a compiler.
 *
 * <p>Every case here is one that would otherwise put a wrong sentence on somebody's campaign
 * page rather than a crash in a log.
 */
describe('reading an update obligation', () => {
  const valid = {
    projectId: '0193f2a1-0000-7000-8000-000000000001',
    state: 'LAPSED',
    openedAt: '2026-01-31T12:00:00Z',
    lastUpdateAt: '2026-02-10T09:00:00Z',
    dueAt: '2026-03-12T09:00:00Z',
    lapsedAt: '2026-03-12T03:15:00Z',
    closedAt: null,
  };

  it('reads a well-formed obligation', () => {
    expect(readUpdateObligation(valid)).toEqual(valid);
  });

  it('refuses a state this build has never seen, rather than defaulting to CURRENT', () => {
    /*
     * The vocabulary can grow: a later issue adding a sixth value is a service that ships
     * before the client does. Falling back to CURRENT would tell a reader a creator is up to
     * date on the strength of a word this build cannot interpret, which is the one wrong
     * answer this whole component exists to avoid.
     */
    expect(readUpdateObligation({ ...valid, state: 'SOMETHING_NEW' })).toBeNull();
  });

  it('keeps a missing last update as null, because that is a different fact from a date', () => {
    // NEVER_UPDATED says "nothing since the campaign closed" and LAPSED says "posted, and not
    // recently". Collapsing them would put the wrong sentence on the page.
    const never = readUpdateObligation({ ...valid, state: 'NEVER_UPDATED', lastUpdateAt: null });
    expect(never?.lastUpdateAt).toBeNull();

    // An empty string is the same absence, and is not a date the formatter should be handed.
    expect(readUpdateObligation({ ...valid, lastUpdateAt: '' })?.lastUpdateAt).toBeNull();
  });

  it.each([null, undefined, 'a string', 42, {}, { projectId: 'x' }])(
    'refuses %o rather than inventing an obligation',
    (body) => {
      expect(readUpdateObligation(body)).toBeNull();
    },
  );
});

describe('reading a creator history', () => {
  const row = {
    projectId: '0193f2a1-0000-7000-8000-000000000001',
    state: 'CURRENT',
    openedAt: '2026-01-31T12:00:00Z',
    lastUpdateAt: null,
    dueAt: '2026-03-02T12:00:00Z',
    lapsedAt: null,
    closedAt: null,
  };

  it('drops a row it cannot read without losing the rest of the list', () => {
    /*
     * One campaign the client cannot narrow must not remove the other eleven from a profile.
     * The whole-list alternative is a page that says a creator has run nothing because one
     * row grew a field.
     */
    const history = readCreatorObligations({
      creatorId: '0193f2a1-0000-7000-8000-0000000000ff',
      obligations: [row, { projectId: 'broken' }, { ...row, state: 'COMPLETE' }],
      lapsedCount: 0,
    });

    expect(history?.obligations).toHaveLength(2);
  });

  it('takes lapsedCount from the server even when a row was dropped', () => {
    // It counts what the server holds rather than what survived narrowing. A number that
    // silently shrank with the list would be the wrong kind of consistent: the profile would
    // say "one late campaign" while the service knows about two.
    const history = readCreatorObligations({
      creatorId: '0193f2a1-0000-7000-8000-0000000000ff',
      obligations: [{ projectId: 'broken' }],
      lapsedCount: 2,
    });

    expect(history?.lapsedCount).toBe(2);
    expect(history?.obligations).toHaveLength(0);
  });

  it('accepts a history with no creator, which is what an unknown slug answers', () => {
    /*
     * The service answers an empty history rather than a 404 for a slug nobody holds, so that
     * this endpoint cannot be used to tell an unknown slug from a closed account — the leak
     * the profile's own 404 exists to prevent. The client must not reintroduce the difference
     * by refusing the body.
     */
    const history = readCreatorObligations({ creatorId: null, obligations: [], lapsedCount: 0 });

    expect(history).not.toBeNull();
    expect(history?.creatorId).toBeNull();
    expect(history?.obligations).toHaveLength(0);
  });
});
