import { describe, expect, it } from 'vitest';
import { UPDATE_PAGE_SIZE, readUpdatePage } from './updates';

/**
 * §4.4's Updates tab, as the public read narrows — #284, shared since #155. The number is the
 * service's, nothing is filtered, and an unusable row is dropped while its neighbours survive.
 */
describe('reading a page of updates', () => {
  it('keeps the number the service allocated rather than the position in the array', () => {
    const page = readUpdatePage({
      updates: [
        { number: 9, title: 'Nine', body: 'b', visibility: 'PUBLIC', publishedAt: '2026-08-01T00:00:00Z' },
        { number: 4, title: 'Four', body: 'b', visibility: 'PUBLIC', publishedAt: '2026-07-01T00:00:00Z' },
      ],
      nextCursor: 3,
    });

    expect(page.updates.map((update) => update.number)).toEqual([9, 4]);
    expect(page.nextCursor).toBe(3);
  });

  it('keeps a backers-only update exactly as the service sent it', () => {
    const page = readUpdatePage({
      updates: [
        {
          number: 2,
          title: 'For backers',
          body: 'The moulds were late.',
          visibility: 'BACKERS_ONLY',
          publishedAt: '2026-08-01T00:00:00Z',
        },
      ],
    });

    expect(page.updates).toHaveLength(1);
    expect(page.updates[0]?.visibility).toBe('BACKERS_ONLY');
  });

  /**
   * The safe default is for the READER, not for the platform: the list has already been
   * filtered by the service, so an unrecognised value is a row it chose to send. Marking it
   * backers-only on a guess would print "Backers only" beside an update everybody can see,
   * which is a claim about who else is reading.
   */
  it('treats an unrecognised visibility as public', () => {
    const page = readUpdatePage({
      updates: [
        { number: 1, title: 'A', body: 'b', visibility: 'SOMETHING_NEW', publishedAt: '2026-08-01T00:00:00Z' },
      ],
    });

    expect(page.updates[0]?.visibility).toBe('PUBLIC');
  });

  it('drops a row with no date or no number and keeps the ones beside it', () => {
    const page = readUpdatePage({
      updates: [
        { number: 3, title: 'Good', body: 'b', publishedAt: '2026-08-01T00:00:00Z' },
        { title: 'No number', body: 'b', publishedAt: '2026-08-01T00:00:00Z' },
        { number: 2, title: 'No date', body: 'b' },
        { number: 1, title: 'Also good', body: 'b', publishedAt: '2026-07-01T00:00:00Z' },
      ],
    });

    expect(page.updates.map((update) => update.number)).toEqual([3, 1]);
  });

  /** A one-line announcement is a title and nothing else, which is a real update. */
  it('keeps an update whose body is empty', () => {
    const page = readUpdatePage({
      updates: [{ number: 1, title: 'It shipped', publishedAt: '2026-08-01T00:00:00Z' }],
    });

    expect(page.updates[0]?.body).toBe('');
  });

  it('answers an empty page for a body that is not one', () => {
    expect(readUpdatePage(null).updates).toEqual([]);
    expect(readUpdatePage('nope').nextCursor).toBeNull();
  });

  it('treats an absent cursor as the last page', () => {
    expect(readUpdatePage({ updates: [] }).nextCursor).toBeNull();
  });
});

describe('the page size', () => {
  it('is twenty', () => {
    expect(UPDATE_PAGE_SIZE).toBe(20);
  });
});
