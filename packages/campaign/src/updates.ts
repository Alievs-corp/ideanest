/**
 * §4.4's Updates tab — §4.9's public read of a campaign's updates, as both clients narrow it.
 *
 * <h2>Only the wire, and why</h2>
 *
 * This is the half of `apps/web/src/lib/community/updates.ts` with nothing web-only in it: the
 * shapes, the page size and the reader. It moved here with #155 so the app's Updates tab shows
 * the same rows with the same numbers. The fetch stays with each client.
 *
 * <h2>Nothing is filtered here</h2>
 *
 * A `BACKERS_ONLY` update that the service chose to send is rendered, because the service is
 * the only thing that knows whether the caller is entitled to it. A client-side filter would be
 * a second, weaker copy of an entitlement rule.
 *
 * <h2>The number is the service's</h2>
 *
 * §4.9 allocates it once, at insert, and never recomputes it — see
 * {@link CampaignUpdate.number}. Neither client numbers the list by position.
 */

/** The two values `project_updates.visibility` holds. Anything else is treated as unknown. */
export type UpdateVisibility = 'PUBLIC' | 'BACKERS_ONLY';

export interface CampaignUpdate {
  /**
   * §4.9's stored number, never a row index.
   *
   * "Update 7 said the moulds were late" is a thing somebody says to support six months
   * later, so the service allocates the number once and never recomputes it. Numbering the
   * list here from its position would renumber every earlier update the first time one was
   * withheld, which is the exact failure that argument exists to prevent.
   */
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly visibility: UpdateVisibility;
  /** ISO-8601 instant, UTC. Never in the future — the public read filters on it. */
  readonly publishedAt: string;
  /** Who wrote it, as an account id. There is no public name behind it yet. */
  readonly authorId: string | null;
}

export interface CampaignUpdatePage {
  readonly updates: readonly CampaignUpdate[];
  /**
   * The next page's cursor, or `null` on the last page.
   *
   * An update cursor is an integer — the update number to read back from — rather than the
   * opaque string the community module's other lists use. That is the service's choice and
   * it is passed back unexamined; the only thing this module asserts about it is that a
   * number is a page and `null` is the end.
   */
  readonly nextCursor: number | null;
}

/**
 * How many updates one page asks for.
 *
 * A campaign that ran for two months has perhaps a dozen; twenty covers nearly all of them
 * in one request, and the "Show older updates" link below the list is what covers the
 * campaigns that have been fulfilling for a year.
 */
export const UPDATE_PAGE_SIZE = 20;

const EMPTY_PAGE: CampaignUpdatePage = Object.freeze({ updates: [], nextCursor: null });

/**
 * The wire body, narrowed to something renderable.
 *
 * Every field of the generated type is optional — springdoc marks a record component
 * required only when it can prove it — so the narrowing happens once, here, rather than at
 * every use in the component. <strong>A row missing its number, title or instant is dropped
 * rather than rendered with a blank</strong>: an update is a dated, numbered statement, and
 * one without a date or a number is not a weaker version of that, it is a row this page
 * cannot describe.
 *
 * Exported for the test, which is the only way to state "an unusable row is dropped and the
 * usable ones beside it survive" without a network.
 */
export function readUpdatePage(body: unknown): CampaignUpdatePage {
  if (body === null || typeof body !== 'object') return EMPTY_PAGE;

  const source = body as Record<string, unknown>;
  const rows = source['updates'];
  const cursor = source['nextCursor'];

  const updates: CampaignUpdate[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows as readonly unknown[]) {
      const update = readUpdate(row);
      if (update !== null) updates.push(update);
    }
  }

  return {
    updates,
    nextCursor: typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : null,
  };
}

function readUpdate(value: unknown): CampaignUpdate | null {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const number = source['number'];
  const title = text(source['title']);
  const publishedAt = text(source['publishedAt']);

  if (typeof number !== 'number' || !Number.isFinite(number)) return null;
  if (title === null || publishedAt === null) return null;

  return {
    number,
    title,
    /*
     * The body may legitimately be empty — a one-line announcement is a title and nothing
     * else — so it falls back to an empty string rather than disqualifying the row. The
     * title and the date are what make an update an update; the body is what it says.
     */
    body: text(source['body']) ?? '',
    visibility: readVisibility(source['visibility']),
    publishedAt,
    authorId: text(source['authorId']),
  };
}

/**
 * `PUBLIC` unless the service said otherwise.
 *
 * Deliberately the safe default for the <em>reader</em> rather than for the platform: this
 * list has already been filtered by the service, so an unrecognised value is a row the
 * service chose to send. Marking it backers-only on a guess would print "Backers only"
 * beside an update everybody can see, which is a claim about who else is reading.
 */
function readVisibility(value: unknown): UpdateVisibility {
  return value === 'BACKERS_ONLY' ? 'BACKERS_ONLY' : 'PUBLIC';
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
