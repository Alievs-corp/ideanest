import type { DirectoryNames } from './directory';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { fillPlaceholders } from '../i18n/placeholders';
import type { MoneyCopy } from '../i18n/admin/money-copy';
import type { Money } from './payments';

/**
 * §4.11's AD-05: the double-entry ledger — issue #305.
 *
 * <p><strong>Postings, not entries.</strong> §7.2's invariant is stated per transaction — for
 * every `transaction_id`, the debits equal the credits — so a list of rows would be a list in
 * which the platform's central accounting rule is invisible. The endpoint groups, and this
 * module keeps the grouping: {@link LedgerPosting} is the unit, and every posting carries all
 * of its sides even when an account filter matched only one of them.
 *
 * <p>That last clause is the reason the filter is safe to offer. A ledger that showed you the
 * escrow half of a double entry because escrow was what you filtered on would be showing a
 * balance that does not balance, which is the one thing this table exists to make impossible.
 */

/** Value arriving where the entry points, or value leaving. */
export type EntryDirection = 'DEBIT' | 'CREDIT';

/**
 * §7.2's seven accounts.
 *
 * <p>Six are fixed names and the seventh is parameterised — `creator:{id}` is one account per
 * creator — so this is not an enumeration of every value the column can hold. It is the set a
 * screen can offer as a filter, which is the five: a chooser over every creator on the
 * platform is a list that grows without bound, and the way to one creator's account is the
 * campaign filter beside it.
 */
export const LEDGER_ACCOUNTS: readonly string[] = Object.freeze([
  'escrow',
  'platform_fee',
  'psp_fee',
  'tax_payable',
  'refunds',
  // IDN-EXT-01 (#42): the platform's own costs, kept apart from backers' refunds.
  'platform_expense',
]);

/** One side of one posting. */
export interface LedgerLine {
  /** The stored account name, which for a creator is `creator:{id}`. */
  account: string;
  direction: EntryDirection;
  /** Always positive; the direction carries the sign. */
  amount: Money;
}

/** Everything the ledger wrote about one transaction. */
export interface LedgerPosting {
  /**
   * The provider call these entries explain.
   *
   * It joins to the payment log (#304), which is the other half of the same event: what was
   * asked of a provider, and what it meant.
   */
  transactionId: string;
  projectId: string;
  /** ISO-8601 instant, UTC. */
  createdAt: string;
  /** Both sides, in the order they were written. Always at least two. */
  lines: LedgerLine[];
  /**
   * Whether the debits equal the credits.
   *
   * <p>It is always true — V41 refuses a commit in which it is not — and it is on the wire so
   * that a reader can see that rather than be told it. A `false` reaching this screen would
   * mean a row arrived past the application and past the database's own trigger, which is an
   * incident and not a rounding note.
   */
  balanced: boolean;
}

/** What one account holds, in one currency. */
export interface LedgerBalance {
  account: string;
  /**
   * Debits minus credits.
   *
   * Positive on `escrow` is money the platform is holding. Positive on a creator's account is
   * money paid out beyond what was earned, which should never happen.
   */
  net: Money;
}

export interface LedgerView {
  /** Echoed, and absent when the request did not ask for it. */
  account?: string | null;
  projectId?: string | null;
  postings: LedgerPosting[];
  /** A number rather than an identifier: `ledger_entries.id` is a sequence. */
  nextCursor?: number | null;
  /**
   * Every account's net, for the campaign asked about or for the whole platform.
   *
   * <p><strong>Not narrowed by the account filter.</strong> Filtering the postings to escrow
   * does not make the other five accounts stop existing, and a one-line balance panel would
   * read as though it were the whole ledger.
   */
  balances: LedgerBalance[];
}

/**
 * How many postings a page holds.
 *
 * <p>Postings, not rows: a posting is at least two entries and occasionally five, so
 * twenty-five of them is between fifty and a hundred and twenty-five lines on screen. Smaller
 * than the other console lists for that reason.
 */
export const LEDGER_PAGE_SIZE = 20;

/**
 * What the ledger may be narrowed by — §4.11's "readable by account and by campaign".
 *
 * <p>Unlike the payment log's two filters, these combine: `ledger_entries` has an index that
 * leads on `(account, project_id)`, so escrow-on-one-campaign is one index read.
 */
export interface LedgerRequest {
  account?: string | null;
  projectId?: string | null;
  after?: number | null;
  limit?: number;
  signal?: AbortSignal;
}

export function ledgerQuery(request: LedgerRequest): string {
  const params = new URLSearchParams();
  params.set('limit', String(request.limit ?? LEDGER_PAGE_SIZE));
  if (request.account != null && request.account !== '') params.set('account', request.account);
  if (request.projectId != null && request.projectId !== '')
    params.set('projectId', request.projectId);
  if (request.after != null) params.set('after', String(request.after));
  return params.toString();
}

/** One page of postings, newest first, with the balances behind them. */
export async function readLedger(request: LedgerRequest = {}): Promise<LedgerView> {
  const response = await authorizedFetch(`/v1/admin/ledger?${ledgerQuery(request)}`, {
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as LedgerView;
}

/** The prefix a creator's own ledger account is stored under — `creator:{uuid}`. */
const CREATOR_PREFIX = 'creator:';

/**
 * The creator identifiers inside a set of ledger account names — issue #402.
 *
 * <p>A creator's account is the one account on the ledger that belongs to a person, and the
 * person is in the account's own name rather than in a field of its own. This is what lets a
 * screen ask the console directory who they are; everything that is not a creator account
 * falls out, including a malformed one, because a lookup on a value that is not an
 * identifier is a request that can only come back empty.
 */
export function creatorIdsIn(accounts: readonly string[]): string[] {
  const found = new Set<string>();
  for (const account of accounts) {
    if (!account.startsWith(CREATOR_PREFIX)) continue;
    const id = account.slice(CREATOR_PREFIX.length);
    if (id !== '') found.add(id);
  }
  return [...found];
}

/**
 * An account's name, in words.
 *
 * <p>A creator's account used to be rendered as "Creator" plus the first characters of the
 * identifier, which was all the ledger knew: nothing turned a creator id into a person, and a
 * screen that pretended otherwise would have been inventing a name. <strong>#402 gave it
 * somewhere to ask.</strong> With the directory's answer the account is the creator's name;
 * without it — before the lookup answers, or when it failed, or when §17.4 has anonymised the
 * account — it is the fragment it always was, which is the honest fallback rather than a
 * blank.
 *
 * <p>An account outside the six is shown verbatim rather than hidden: the column has a check
 * constraint, so a value that is not one of these is something worth seeing.
 *
 * <p>The names arrive as a parameter since #324. They are `admin.money.account`, keyed by the
 * same stored values {@link LEDGER_ACCOUNTS} lists, and this module is imported by a client
 * component that cannot read a catalogue.
 *
 * @param names what the console directory resolved, or nothing. Optional so that the two
 *     callers with no identifiers to resolve — and every test of the six fixed names — do
 *     not have to invent an empty one
 */
export function accountLabel(account: string, copy: MoneyCopy, names?: DirectoryNames): string {
  const known = copy.account[account];
  if (known !== undefined) return known;

  if (account.startsWith(CREATOR_PREFIX)) {
    const id = account.slice(CREATOR_PREFIX.length);
    const name = names?.accounts.get(id)?.name;
    return name === undefined
      ? fillPlaceholders(copy.creatorAccount, { id: id.slice(0, 8) })
      : fillPlaceholders(copy.creatorNamed, { name });
  }
  return account;
}
