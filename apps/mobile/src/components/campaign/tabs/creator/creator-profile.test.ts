import {
  CREATOR_PROJECT_LIMIT,
  otherCampaigns,
  readCreatorProfile,
  readCreatorProjects,
  type CreatorProject,
} from './creator-profile';

/**
 * The Creator tab's narrowing (#155) — the web's `lib/profiles/wire.ts` rules, restated for the
 * fields the tab draws: a profile without a slug or a name is no profile, a campaign row without
 * the five fields that make a link is dropped, and an absent field is `null`, never a blank or
 * an invented date.
 */

describe('readCreatorProfile', () => {
  it('keeps the fields the tab draws, and nulls the absent ones', () => {
    expect(
      readCreatorProfile({ slug: 'aysel', name: ' Aysel ', bio: '', joinedAt: null, extra: 1 }),
    ).toEqual({ slug: 'aysel', name: 'Aysel', avatarUrl: null, bio: null, joinedAt: null });
  });

  it('is null without a slug or a name, and for anything that is not an object', () => {
    expect(readCreatorProfile({ name: 'Aysel' })).toBeNull();
    expect(readCreatorProfile({ slug: 'aysel', name: '   ' })).toBeNull();
    expect(readCreatorProfile(null)).toBeNull();
    expect(readCreatorProfile('aysel')).toBeNull();
    expect(readCreatorProfile([])).toBeNull();
  });
});

describe('readCreatorProjects', () => {
  const row = { id: 'p1', title: 'Lamp', slug: 'lamp', creatorSlug: 'aysel', state: 'LIVE' };

  it('drops a row that cannot be a link and keeps the ones beside it', () => {
    expect(
      readCreatorProjects({
        projects: [row, { ...row, id: 'p2', slug: '' }, { ...row, id: 'p3', state: undefined }, 7],
      }),
    ).toEqual([{ ...row, blurb: null }]);
  });

  it('is empty for a body with no list', () => {
    expect(readCreatorProjects({})).toEqual([]);
    expect(readCreatorProjects(undefined)).toEqual([]);
  });
});

describe('otherCampaigns', () => {
  const project = (id: string): CreatorProject => ({
    id,
    title: id,
    slug: id,
    creatorSlug: 'aysel',
    blurb: null,
    state: 'LIVE',
  });

  it('leaves out the campaign being read and keeps at most six, in order', () => {
    const seven = ['a', 'current', 'b', 'c', 'd', 'e', 'f'].map(project);
    expect(otherCampaigns(seven, 'current').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(CREATOR_PROJECT_LIMIT).toBe(6);

    const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(project);
    expect(otherCampaigns(eight, 'current')).toHaveLength(6);
  });
});
