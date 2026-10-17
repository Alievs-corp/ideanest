import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import { listUsers, readUserPledges } from './api';

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));

const fetchMock = vi.mocked(authorizedFetch);

function answered(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The account reads, at the boundary where the wire shape becomes the typed one.
 *
 * <p>The service omits null fields, so the last page has no `nextCursor` key at all. The
 * directory read that `undefined` as "there is more", asked again without a cursor, and drew
 * the first page a second time under itself.
 */
describe('the account directory client', () => {
  it('reads a last page with no cursor field as the end of the list', async () => {
    fetchMock.mockResolvedValue(answered({ users: [] }));

    const page = await listUsers();

    expect(page.nextCursor).toBeNull();
  });

  it('keeps the cursor the service did send', async () => {
    fetchMock.mockResolvedValue(answered({ users: [], nextCursor: 'last-id' }));

    expect((await listUsers()).nextCursor).toBe('last-id');
  });

  it('sends the cursor back as `after`', async () => {
    fetchMock.mockResolvedValue(answered({ users: [] }));

    await listUsers({ after: 'last-id' });

    const [path] = fetchMock.mock.calls[0]!;
    expect(path).toContain('after=last-id');
  });

  it("reads an account's last page of pledges as the end too", async () => {
    fetchMock.mockResolvedValue(answered({ pledges: [] }));

    expect((await readUserPledges('account-id')).nextCursor).toBeNull();
  });
});
