/**
 * §22.2's eight documents, as the client reads them — issues #425 and #439.
 *
 * <h2>The kinds are closed here as well as in the service</h2>
 *
 * `DocumentKind` and V65's `legal_documents_kind_known` already say the same eight names, and
 * this is the third statement of the same closed set. It is not redundancy for its own sake:
 * this list is what turns a URL segment into a document, and a ninth appearing would otherwise
 * be a 404 that looked like a routing bug rather than a change to §22.2.
 *
 * <h2>The address is a slug, and the slug is not the enum</h2>
 *
 * `/legal/terms-of-use`, not `/legal/TERMS_OF_USE`. A URL is read aloud, pasted into a
 * regulator's email and printed at the bottom of an invoice, and a database value in one is the
 * platform showing its plumbing — the same argument `DocumentKind` itself makes about why the
 * kind is not the title.
 *
 * The mapping is stated once, here, in both directions. Two independent transformations would
 * be a page that generates a link it cannot resolve.
 */

/** §22.2's eight, in the order that section lists them. */
export const LEGAL_DOCUMENTS = [
  'terms-of-use',
  'privacy-policy',
  'cookie-policy',
  'platform-rules',
  'creator-agreement',
  'backer-agreement',
  'delivery-and-refund-policy',
  'dispute-resolution-policy',
] as const;

export type LegalDocumentSlug = (typeof LEGAL_DOCUMENTS)[number];

/** The service's vocabulary, which never appears in a URL or on a page. */
export type LegalDocumentKind =
  | 'TERMS_OF_USE'
  | 'PRIVACY_POLICY'
  | 'COOKIE_POLICY'
  | 'PLATFORM_RULES'
  | 'CREATOR_AGREEMENT'
  | 'BACKER_AGREEMENT'
  | 'DELIVERY_AND_REFUND_POLICY'
  | 'DISPUTE_RESOLUTION_POLICY';

const KIND_BY_SLUG: Record<LegalDocumentSlug, LegalDocumentKind> = {
  'terms-of-use': 'TERMS_OF_USE',
  'privacy-policy': 'PRIVACY_POLICY',
  'cookie-policy': 'COOKIE_POLICY',
  'platform-rules': 'PLATFORM_RULES',
  'creator-agreement': 'CREATOR_AGREEMENT',
  'backer-agreement': 'BACKER_AGREEMENT',
  'delivery-and-refund-policy': 'DELIVERY_AND_REFUND_POLICY',
  'dispute-resolution-policy': 'DISPUTE_RESOLUTION_POLICY',
};

export function isLegalDocumentSlug(value: string): value is LegalDocumentSlug {
  return (LEGAL_DOCUMENTS as readonly string[]).includes(value);
}

/** The kind behind an address. Total, because the argument is narrowed first. */
export function kindOf(slug: LegalDocumentSlug): LegalDocumentKind {
  return KIND_BY_SLUG[slug];
}

/**
 * One published version, with its text.
 *
 * @param title the document's name in its own language. Drawn as the page's heading, so the
 *   platform never prints `CREATOR_AGREEMENT` at somebody
 * @param locale the language this text is actually in, which is **not necessarily the one that
 *   was asked for**. The service falls back to the governing Azerbaijani text rather than
 *   answering 404, and the page says so — a reader shown a blank page has been told nothing,
 *   and a reader shown the governing text without being told which language it is in has been
 *   told something confusing
 * @param contentHash the SHA-256 of the body, published deliberately: it is what a SİMA
 *   signature is taken over, so somebody who signed a version can check afterwards that the
 *   text they are being shown is the text they signed
 */
export interface LegalDocument {
  readonly kind: string;
  readonly locale: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly contentHash: string;
  readonly effectiveFrom: string | null;
  readonly publishedAt: string | null;
}

/** One version without its text — what a catalogue and an archive list draw. */
export interface LegalDocumentSummary {
  readonly kind: string;
  readonly locale: string;
  readonly version: number;
  readonly title: string;
  readonly effectiveFrom: string | null;
}

/**
 * What a read of one legal document came back with — issue #147.
 *
 * <h2>Three answers, because there are three facts</h2>
 *
 * `unpublished` is the service answering 404: no version of this document is in force, which is
 * this platform's state until #423's adviser delivers the words, and a page says so plainly.
 * `unavailable` is everything else that is not a document — a 5xx, a timeout, a DNS failure, a
 * body that does not narrow. It says nothing about whether the document exists, and a page that
 * drew it as "not published" would tell a reader during an outage that IdeyaNest has no terms of
 * use, which §22.2 requires it to have.
 *
 * The two used to be one `null`. They are kept apart all the way to the render so that no
 * caller can collapse them again without writing the branch down.
 */
export type LegalRead<T> =
  | { readonly state: 'published'; readonly document: T }
  | { readonly state: 'unpublished' }
  | { readonly state: 'unavailable' };

export const LEGAL_UNPUBLISHED: LegalRead<never> = { state: 'unpublished' };
export const LEGAL_UNAVAILABLE: LegalRead<never> = { state: 'unavailable' };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalInstant(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * One document, or `null`.
 *
 * <strong>An empty body narrows to `null`.</strong> V65 refuses one, so this can only be a
 * client reading something it should not have been given — and a legal page rendering an empty
 * document would tell a reader they had read the terms.
 */
export function readLegalDocument(body: unknown): LegalDocument | null {
  if (!isObject(body)) return null;
  if (typeof body.kind !== 'string' || typeof body.locale !== 'string') return null;
  if (typeof body.version !== 'number' || typeof body.title !== 'string') return null;
  if (typeof body.body !== 'string' || body.body.trim() === '') return null;
  if (typeof body.contentHash !== 'string') return null;

  return {
    kind: body.kind,
    locale: body.locale,
    version: body.version,
    title: body.title,
    body: body.body,
    contentHash: body.contentHash,
    effectiveFrom: optionalInstant(body.effectiveFrom),
    publishedAt: optionalInstant(body.publishedAt),
  };
}

/** Everything in force, without the bodies. `GET /v1/legal/documents`. */
export function readLegalCatalogue(body: unknown): readonly LegalDocumentSummary[] | null {
  if (!isObject(body)) return null;
  if (!Array.isArray(body.documents)) return null;

  return body.documents
    .map((row): LegalDocumentSummary | null => {
      if (!isObject(row)) return null;
      if (typeof row.kind !== 'string' || typeof row.locale !== 'string') return null;
      if (typeof row.version !== 'number' || typeof row.title !== 'string') return null;

      return {
        kind: row.kind,
        locale: row.locale,
        version: row.version,
        title: row.title,
        effectiveFrom: optionalInstant(row.effectiveFrom),
      };
    })
    .filter((row): row is LegalDocumentSummary => row !== null);
}

/** The address of one document, and of one archived version of it. */
export function legalPath(slug: LegalDocumentSlug, version?: number): string {
  return version === undefined ? `/legal/${slug}` : `/legal/${slug}/v/${version}`;
}

/**
 * An archived version's address segment as a number, or `null` for one that names no version.
 *
 * A positive integer of at most five digits, with no leading zero: `/v/07` and `/v/7` would
 * otherwise be two addresses for one text, and a segment that is not a version is a not-found
 * page before any request is made.
 */
export function archivedVersionOf(segment: string): number | null {
  if (!/^[1-9][0-9]{0,4}$/u.test(segment)) return null;
  return Number(segment);
}

/**
 * A document's body as the paragraphs it is drawn in.
 *
 * <strong>Split on blank lines and rendered as text, never as markup.</strong> The body is written
 * by an administrator into `legal_documents.body`, and a legal page that interpreted markup would
 * be a stored-XSS hole on the web and a second renderer on the phone, on the one surface where a
 * reader's guard is lowest. Both clients draw each piece as plain text; this only decides where
 * the paragraphs are. A line holding only whitespace counts as blank, so CRLF text splits too.
 *
 * A document written with single newlines is one paragraph with its line breaks collapsed — which
 * is what a browser does with the same text, and a rendering decision rather than a loss.
 */
export function paragraphsOf(body: string): readonly string[] {
  return body
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}
