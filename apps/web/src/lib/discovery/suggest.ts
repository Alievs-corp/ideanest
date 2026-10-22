import { publicFetch } from '../api/client';
import { withMarket } from '../market/cookie';
import { errorFrom } from '../api/problem';

/**
 * The typed client for `GET /v1/search/suggest` — D-02's autocomplete.
 *
 * Shapes come from `DiscoveryResponses.Suggestions`; nothing here invents a
 * field. `publicFetch`, for the reason `api.ts` gives: discovery is the front
 * door and a visitor who has not registered is exactly the audience it exists
 * for.
 */

/**
 * The four things a suggestion can be, spelled as `Suggestion.Kind` spells
 * them on the wire.
 *
 * THE KIND IS THE ROUTING DECISION, which is the whole reason the endpoint
 * sends it: "games" is a category, "handmade" is a tag, and "Games Night" is a
 * campaign, and each of the three leads somewhere different. A client that
 * ignored it could only paste the label back into the search box, which is the
 * one thing the reader could already do.
 */
export const SUGGESTION_KINDS = ['campaign', 'category', 'subcategory', 'tag'] as const;

export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export interface Suggestion {
  kind: SuggestionKind;
  /** The unfolded form, as it was written. Never the folded one. */
  label: string;
  slug: string;
  /**
   * What qualifies the slug: a subcategory's category, a campaign's creator.
   * Absent for a category and a tag, and absent means absent — the service
   * serialises with `non_null`, so the key is missing rather than null.
   */
  parentSlug?: string | null;
}

export interface Suggestions {
  items: readonly Suggestion[];
}

/**
 * How short a fragment is worth asking about — `SuggestQuery.MIN_LENGTH`.
 *
 * COPIED FROM THE SERVICE, and enforced again here rather than trusted to it.
 * The endpoint answers a one-character fragment with an empty list, so sending
 * one is not an error; it is a request that cannot succeed, issued on the
 * first keystroke of every session by every visitor. "a" is a prefix of a large
 * fraction of everything, so the answer is both expensive and useless.
 */
export const SUGGEST_MIN_LENGTH = 2;

/** `SuggestQuery.DEFAULT_LIMIT`. Ten rows is what fits without scrolling. */
export const SUGGEST_LIMIT = 10;

/** Whether this fragment can be answered at all. Mirrors `SuggestQuery.isAnswerable()`. */
export function isAnswerable(text: string): boolean {
  return text.trim().length >= SUGGEST_MIN_LENGTH;
}

export async function getSuggestions(
  text: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<readonly Suggestion[]> {
  const params = withMarket(
    new URLSearchParams({
      q: text.trim(),
      limit: String(options.limit ?? SUGGEST_LIMIT),
    }),
  );

  const response = await publicFetch(`/v1/search/suggest?${params.toString()}`, {
    signal: options.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as Suggestions;
  return body.items;
}

/* -------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------- */

/*
 * THE WORD FOR A KIND MOVED TO `discovery.suggest.kinds` — issue #324.
 *
 * It is rendered as TEXT beside the label: not an icon, and not a colour. Four kinds that lead
 * to four different places are meaning, and docs/ui-kit.md §9.2 forbids meaning carried by
 * colour or by an icon alone — a reader who cannot tell a tag from a campaign cannot predict
 * what pressing Enter will do. `SearchBox` looks the word up in the copy the route resolved.
 */

/**
 * A stable DOM id for one row.
 *
 * It is what `aria-activedescendant` points at, so it has to be unique within
 * one list and the same across renders of the same row. Kind plus slug is
 * unique: slugs collide across kinds — a "games" category and a "games" tag —
 * and a subcategory slug is only unique within its parent (V6), which is why
 * the parent is in it too.
 */
export function suggestionId(suggestion: Suggestion): string {
  return `suggestion-${suggestion.kind}-${suggestion.parentSlug ?? ''}-${suggestion.slug}`;
}
