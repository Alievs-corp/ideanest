/**
 * §4.4's FAQ tab — the public read of a campaign's questions, as both clients narrow it.
 *
 * <h2>Only the wire, and why</h2>
 *
 * This is the half of `apps/web/src/lib/community/faqs.ts` with nothing web-only in it: the
 * shape, the cap and the reader. It moved here with #155 so the app's FAQ tab keeps the
 * creator's order and drops a half-written row exactly as the web does. The fetch stays with
 * each client.
 *
 * <h2>Not paged, and the order is the creator's</h2>
 *
 * §4.4 caps the list at {@link CAMPAIGN_FAQ_LIMIT} entries server-side and publishes no cursor,
 * so everything the service will send for one campaign arrives in one body. `sort_order` is what
 * the editor's move controls write, and nothing here re-sorts it: a client that sorted the list
 * would discard a creator's decision about which question a backer reads first.
 */

/**
 * One question and the creator's answer to it.
 *
 * Hand-written rather than `SchemaProjectFaqResponse`, because every field of the generated
 * type is optional — springdoc marks a record component required only when it can prove it —
 * and a component destructuring `faq.question` off that type would be handed
 * `string | undefined` at every use. The narrowing happens once, in {@link readFaqList}.
 */
export interface CampaignFaq {
  /** The service's identifier. Survives a reorder, which is why §4.4 made this a table. */
  readonly id: string;
  /** At most 200 characters, and never blank — the service refuses both. */
  readonly question: string;
  /** At most 4000 characters, and never blank. Plain text, never markup. */
  readonly answer: string;
}

/**
 * The server-side cap, restated for the reader rather than enforced here.
 *
 * Nothing below truncates to it. The service is what decides how many entries a campaign may
 * publish, and a client that trimmed the list to its own idea of the limit would hide the
 * fifty-first entry from a reader instead of showing the creator that they had reached the
 * cap. It is here so that the editor and this reader agree on one number.
 */
export const CAMPAIGN_FAQ_LIMIT = 50;

/** The list a campaign with no questions has. Frozen so a caller cannot push into it. */
const EMPTY: readonly CampaignFaq[] = Object.freeze([]);

/**
 * The wire body, narrowed to something renderable, in the order it arrived.
 *
 * <strong>A row missing its identifier, its question or its answer is dropped rather than
 * rendered with a blank.</strong> An FAQ entry is a question and an answer to it; one with
 * neither half is not a shorter entry, it is a row this tab cannot describe, and a question
 * printed with an empty answer below it reads as a creator refusing to answer.
 *
 * The identifier is required for the same reason the editor needs it — it is the key React
 * lists by and the value a reorder sends — and a row without one would be a row that could
 * not be told apart from the next.
 *
 * Exported for the test, which is the only way to state "an unusable row is dropped and the
 * usable ones beside it survive" without a network.
 */
export function readFaqList(body: unknown): readonly CampaignFaq[] {
  if (body === null || typeof body !== 'object') return EMPTY;

  const rows = (body as Record<string, unknown>)['faqs'];
  if (!Array.isArray(rows)) return EMPTY;

  const faqs: CampaignFaq[] = [];
  for (const row of rows as readonly unknown[]) {
    const faq = readFaq(row);
    if (faq !== null) faqs.push(faq);
  }

  return faqs;
}

function readFaq(value: unknown): CampaignFaq | null {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const id = text(source['id']);
  const question = text(source['question']);
  const answer = text(source['answer']);

  if (id === null || question === null || answer === null) return null;
  return { id, question, answer };
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
