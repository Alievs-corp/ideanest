import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import { readRevisionReview } from './revisions';

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));

const fetchMock = vi.mocked(authorizedFetch);

function answered(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

const BASE = {
  id: '0193f2a1-0000-7000-8000-00000000b001',
  projectId: '0193f2a1-0000-7000-8000-00000000c001',
  status: 'PENDING',
  live: { title: 'Cedar and Salt' },
  proposed: { title: 'Cedar and Sea Salt' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The edit review, at the boundary where the wire shape becomes the typed one.
 *
 * <p>A revision saved before #587 holds no items and no shipping zones, and the service omits
 * an empty or null field, so the page must not read a missing one as a crash or as a change.
 */
describe('the edit review client', () => {
  it('reads a review with no lists at all as one that changes no tier, item or zone', async () => {
    fetchMock.mockResolvedValue(answered(BASE));

    const review = await readRevisionReview(BASE.id);

    expect(review.changedFields).toEqual([]);
    expect(review.rewards).toEqual([]);
    expect(review.items).toEqual([]);
    expect(review.shippingZones).toBeNull();
  });

  it('reads null items and null zones the same way', async () => {
    fetchMock.mockResolvedValue(answered({ ...BASE, items: null, shippingZones: null }));

    const review = await readRevisionReview(BASE.id);

    expect(review.items).toEqual([]);
    expect(review.shippingZones).toBeNull();
  });

  it('fills a missing side of the zones and a missing list of item fields with empty ones', async () => {
    fetchMock.mockResolvedValue(
      answered({
        ...BASE,
        items: [{ id: 'item', live: { name: 'Mug' }, proposed: { name: 'Cup' } }],
        shippingZones: { proposed: [{ id: 'zone', name: 'Europe', countryCodes: ['DE'] }] },
      }),
    );

    const review = await readRevisionReview(BASE.id);

    expect(review.items[0]?.changedFields).toEqual([]);
    expect(review.shippingZones).toEqual({ live: [], proposed: [{ id: 'zone', name: 'Europe', countryCodes: ['DE'] }] });
  });

  it('keeps what the service did send', async () => {
    const items = [{ id: 'item', changedFields: ['name'], live: { name: 'Mug' }, proposed: { name: 'Cup' } }];
    const shippingZones = { live: [], proposed: [] };
    fetchMock.mockResolvedValue(answered({ ...BASE, changedFields: ['items', 'shippingZones'], items, shippingZones }));

    const review = await readRevisionReview(BASE.id);

    expect(review.changedFields).toEqual(['items', 'shippingZones']);
    expect(review.items).toEqual(items);
    expect(review.shippingZones).toEqual(shippingZones);
  });
});
