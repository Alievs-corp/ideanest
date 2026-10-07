import * as client from '../../api/client';
import { listFollowing, listMyProjects, listSaved, unfollowCreator } from './api';
import { PUBLIC_STATES, hasLaunched, isPubliclyVisible, myCampaignHref } from './campaign-routes';
import { insertAt, rowsOf, type Pages } from './use-cursor-list';

jest.mock('../../api/client', () => ({ api: jest.fn(), sendJson: jest.fn() }));

const get = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(client.api).mockReturnValue({ get } as unknown as ReturnType<typeof client.api>);
});

describe('myCampaignHref', () => {
  it.each([...PUBLIC_STATES])('sends a %s campaign to its public page', (state) => {
    expect(myCampaignHref({ id: 'p1', state, creatorSlug: 'aysel', slug: 'lamp' })).toEqual({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'lamp' },
    });
  });

  it.each(['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'REJECTED', 'SUSPENDED'])(
    'sends a %s campaign to the editor',
    (state) => {
      expect(myCampaignHref({ id: 'p1', state, creatorSlug: 'aysel', slug: 'lamp' })).toEqual({
        pathname: '/campaigns/[id]/edit/basics',
        params: { id: 'p1' },
      });
    },
  );

  it('sends a public campaign without its slugs to the editor rather than to a 404', () => {
    expect(myCampaignHref({ id: 'p1', state: 'LIVE' }).pathname).toBe('/campaigns/[id]/edit/basics');
  });

  it('agrees with the web on which states are public and which have launched', () => {
    expect(PUBLIC_STATES.size).toBe(12);
    expect(isPubliclyVisible('PRELAUNCH')).toBe(true);
    expect(hasLaunched('PRELAUNCH')).toBe(false);
    expect(hasLaunched('SUSPENDED')).toBe(true);
    expect(hasLaunched('DRAFT')).toBe(false);
    expect(hasLaunched('LIVE')).toBe(true);
  });
});

describe('insertAt', () => {
  const pages: Pages<string> = {
    pages: [
      { items: ['a', 'b'], nextCursor: 'c2' },
      { items: ['d'], nextCursor: null },
    ],
    pageParams: [null, 'c2'],
  };

  it('puts a row back at its flat index, across pages', () => {
    expect(rowsOf(insertAt(pages, 0, 'x'))).toEqual(['x', 'a', 'b', 'd']);
    expect(rowsOf(insertAt(pages, 2, 'c'))).toEqual(['a', 'b', 'c', 'd']);
    expect(rowsOf(insertAt(pages, 3, 'e'))).toEqual(['a', 'b', 'd', 'e']);
  });

  it('appends when the index is past the end, and leaves the cursors alone', () => {
    const inserted = insertAt(pages, 99, 'z');
    expect(rowsOf(inserted)).toEqual(['a', 'b', 'd', 'z']);
    expect(inserted.pages.map((page) => page.nextCursor)).toEqual(['c2', null]);
    expect(inserted.pageParams).toEqual([null, 'c2']);
  });
});

describe('the account reads', () => {
  it('ask for 24 at a time, with the cursor when there is one', async () => {
    get.mockResolvedValue({ items: [], projects: [] });
    await listSaved(null);
    await listFollowing('c2');
    await listMyProjects('c3');

    expect(get).toHaveBeenNthCalledWith(1, '/v1/me/saved', { query: { size: 24 } });
    expect(get).toHaveBeenNthCalledWith(2, '/v1/me/following', { query: { size: 24, cursor: 'c2' } });
    expect(get).toHaveBeenNthCalledWith(3, '/v1/me/projects', { query: { limit: 24, cursor: 'c3' } });
  });

  it('drop rows that cannot be keyed, and read the end of the list as null', async () => {
    get.mockResolvedValueOnce({
      items: [{ projectId: 'p1', title: 'Lamp', creatorSlug: 'a', projectSlug: 'lamp', savedAt: 'x' }, { title: 'no id' }],
    });
    expect(await listSaved(null)).toEqual({
      items: [{ projectId: 'p1', title: 'Lamp', creatorSlug: 'a', projectSlug: 'lamp', savedAt: 'x' }],
      nextCursor: null,
    });

    get.mockResolvedValueOnce({ items: [{ creatorId: 'u1', slug: 'aysel', followedAt: 'x' }, { name: 'nobody' }], nextCursor: 'n' });
    expect(await listFollowing(null)).toEqual({
      items: [{ creatorId: 'u1', slug: 'aysel', name: 'aysel', followedAt: 'x' }],
      nextCursor: 'n',
    });
  });

  it('unfollows by the encoded slug', async () => {
    jest.mocked(client.sendJson).mockResolvedValueOnce({ following: false });
    expect(await unfollowCreator('ay sel')).toBe(false);
    expect(client.sendJson).toHaveBeenCalledWith('DELETE', '/v1/users/ay%20sel/follow');
  });
});
