import { authorizedFetch } from '../api/client';
import { ApiError, errorFrom } from '../api/problem';
import type { BlockFailureCopy } from '../i18n/block-copy';
import type { Page } from './signals';

/**
 * §4.9's C-08 — blocking another account, issue #324. App Store Review Guideline 1.2 is why it
 * exists; `BlockService` in the API carries what a block does and does not do.
 *
 * <h2>Two addresses for one person, because the two buttons hold different things</h2>
 *
 * A comment carries its author's account id and no slug, so the control under a comment
 * blocks by id (`/v1/me/blocks/{userId}`). A public profile carries a slug and deliberately no
 * id, so the control on a profile blocks by slug (`/v1/users/{slug}/block`), as following and
 * reporting already do. The settings list unblocks by id, which every row carries.
 *
 * <h2>Every call is the browser's</h2>
 *
 * A block is the most private list an account keeps here, so nothing about it is read on the
 * server or cached: each call goes through `authorizedFetch`, which carries the session and
 * throws a 401 when there is none.
 */

/** One row of the blocked list — `GET /v1/me/blocks`. */
export interface BlockedAccount {
  readonly userId: string;
  readonly name: string;
  readonly slug: string;
  /** `null` for an account without a picture, which is most of them. */
  readonly avatarUrl: string | null;
  /** ISO-8601 instant, UTC. */
  readonly blockedAt: string;
}

const PAGE_SIZE = 24;

/**
 * How many pages of the list {@link blockedIds} reads before it stops.
 *
 * The comments tab needs every id the reader blocked to hide them, and the list is paged. Ten
 * pages of the service's ceiling is a thousand people — a bound rather than a loop that
 * follows a cursor for ever, and far past anybody who is blocking abusers rather than
 * cataloguing the platform.
 */
const ID_SCAN_PAGES = 10;
const ID_SCAN_PAGE_SIZE = 100;

interface RawPage {
  readonly items?: readonly Partial<BlockedAccount>[];
  readonly nextCursor?: string | null;
}

function rowOf(raw: Partial<BlockedAccount>): BlockedAccount | null {
  if (typeof raw.userId !== 'string' || typeof raw.slug !== 'string') return null;
  return {
    userId: raw.userId,
    name: typeof raw.name === 'string' ? raw.name : raw.slug,
    slug: raw.slug,
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    blockedAt: typeof raw.blockedAt === 'string' ? raw.blockedAt : '',
  };
}

async function readPage(
  cursor: string | null,
  size: number,
  signal?: AbortSignal,
): Promise<Page<BlockedAccount>> {
  const query = new URLSearchParams({ size: String(size) });
  if (cursor !== null) query.set('cursor', cursor);

  const response = await authorizedFetch(`/v1/me/blocks?${query.toString()}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as RawPage;
  return {
    items: (body.items ?? []).map(rowOf).filter((row): row is BlockedAccount => row !== null),
    nextCursor: body.nextCursor ?? null,
  };
}

/** One page of the people this account blocked, most recent first. The cursor is passed back unread. */
export function listBlocked(
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<Page<BlockedAccount>> {
  return readPage(cursor, PAGE_SIZE, signal);
}

/**
 * Every account id this reader has blocked, up to {@link ID_SCAN_PAGES} pages.
 *
 * What the comments tab hides by. The tab is read anonymously on the server — it is public
 * content in the initial HTML — so the reader's own blocks are applied here, in the browser,
 * from the reader's own list.
 */
export async function blockedIds(signal?: AbortSignal): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let read = 0; read < ID_SCAN_PAGES; read += 1) {
    const page: Page<BlockedAccount> = await readPage(cursor, ID_SCAN_PAGE_SIZE, signal);
    for (const row of page.items) ids.add(row.userId);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return ids;
}

/** Blocks the author of a comment. Idempotent: blocking twice is one block. */
export async function blockAccount(userId: string): Promise<void> {
  const response = await authorizedFetch(`/v1/me/blocks/${encodeURIComponent(userId)}`, {
    method: 'POST',
  });
  if (!response.ok) throw await errorFrom(response);
}

/** Lifts a block. Idempotent: unblocking somebody not blocked succeeds. */
export async function unblockAccount(userId: string): Promise<void> {
  const response = await authorizedFetch(`/v1/me/blocks/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw await errorFrom(response);
}

function blockPath(slug: string): string {
  return `/v1/users/${encodeURIComponent(slug)}/block`;
}

async function readState(response: Response): Promise<boolean> {
  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json()) as { readonly blocked?: boolean };
  return body.blocked === true;
}

/** Whether this reader has blocked the account behind a profile. */
export async function isBlocked(slug: string, signal?: AbortSignal): Promise<boolean> {
  return readState(await authorizedFetch(blockPath(slug), { signal }));
}

/** Blocks from a profile. Answers the resulting state, which is the service's to say. */
export async function blockBySlug(slug: string): Promise<boolean> {
  return readState(await authorizedFetch(blockPath(slug), { method: 'POST' }));
}

/** Unblocks from a profile. Answers the resulting state. */
export async function unblockBySlug(slug: string): Promise<boolean> {
  return readState(await authorizedFetch(blockPath(slug), { method: 'DELETE' }));
}

/**
 * The sentence a failed block or unblock shows, in the reader's language.
 *
 * Branches on the problem's `code` and never on its prose, which is the service's English: the
 * two refusals a person can meet by pressing the button are said in the catalogue, and anything
 * else is a generic refusal rather than a sentence the reader cannot read.
 */
export function blockFailureMessage(cause: unknown, failures: BlockFailureCopy): string {
  if (cause instanceof ApiError) {
    if (cause.problem?.code === 'CANNOT_BLOCK_STAFF') return failures.staff;
    if (cause.problem?.code === 'CANNOT_BLOCK_YOURSELF') return failures.self;
    return failures.refused;
  }
  return failures.unreachable;
}
