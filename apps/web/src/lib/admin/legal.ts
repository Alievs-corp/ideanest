import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §22.2's eight documents, from the console — issue #425.
 *
 * <h2>Publishing is not an edit, and the console has to say so</h2>
 *
 * A published version is immutable: V65 puts a trigger on the table, `LegalDocument` refuses
 * it above, and there is deliberately no entry point for it here. The reason is what an
 * acceptance is — `document_acceptances` names a version, and an acceptance of a text that
 * can be edited afterwards is evidence of nothing.
 *
 * So a correction is a new version, and the previous one stays readable because somebody who
 * accepted it is entitled to read what they accepted. `FeeEditor` makes the same argument
 * about a rate and reaches the same shape, one step stronger: a fee schedule is closed and
 * replaced, and a legal document is never even closed.
 *
 * <h2>A draft is per language; a publication is per document</h2>
 *
 * {@link writeDraft} takes a locale, because somebody writes one language at a time.
 * {@link publishDocument} does not, because a version is published in every language it has
 * been translated into under one number and one effective date — a publication that could
 * half-happen would leave days in which what a reader agreed to and what governed them were
 * different documents.
 *
 * And nothing publishes without the Azerbaijani text, which the service refuses with
 * `GOVERNING_TEXT_MISSING`: that is the text that governs, and the other three exist so a
 * person can read what they are agreeing to.
 */

/** §22.2's eight, as the service names them. */
export const DOCUMENT_KINDS = [
  'TERMS_OF_USE',
  'PRIVACY_POLICY',
  'COOKIE_POLICY',
  'PLATFORM_RULES',
  'CREATOR_AGREEMENT',
  'BACKER_AGREEMENT',
  'DELIVERY_AND_REFUND_POLICY',
  'DISPUTE_RESOLUTION_POLICY',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** §21.1's four. The first is the one that governs. */
export const DOCUMENT_LOCALES = ['az', 'en', 'ru', 'tr'] as const;

export type DocumentLocale = (typeof DOCUMENT_LOCALES)[number];

/** One version, without its text. What the history list draws. */
export interface DocumentSummary {
  kind: string;
  locale: string;
  version: number;
  title: string;
  /**
   * SHA-256 of the body, lower-case hex.
   *
   * Shown rather than hidden. It is what #429's signature is taken over, and publishing it
   * is what lets somebody who accepted a version check afterwards that the text they are
   * shown is the text they agreed to.
   */
  contentHash: string;
  effectiveFrom?: string | null;
  publishedAt?: string | null;
}

/** One version with its text. What the editor loads into its fields. */
export interface DocumentDraft extends DocumentSummary {
  body: string;
}

export interface DocumentHistory {
  kind: string;
  /** Published versions, newest first. */
  versions: DocumentSummary[];
  /** The open drafts, one per language at most. */
  drafts: DocumentDraft[];
  /** The version readers are shown right now, or null when nothing is in force. */
  inForceVersion?: number | null;
}

/** Every version of one document, and whatever is drafted against it. */
export async function readDocumentHistory(
  kind: DocumentKind,
  signal?: AbortSignal,
): Promise<DocumentHistory> {
  const response = await authorizedFetch(`/v1/admin/legal/documents/${kind}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as DocumentHistory;
}

export interface WriteDraftRequest {
  readonly kind: DocumentKind;
  readonly locale: DocumentLocale;
  readonly title: string;
  readonly body: string;
  readonly signal?: AbortSignal;
}

/**
 * Writes the draft of the next version in one language.
 *
 * `PUT`, and idempotent in the sense `PUT` means: there is one draft of a document in a
 * language, and sending the text again replaces it. An editor that created a row per save
 * would leave an administrator choosing between six drafts of the same paragraph.
 */
export async function writeDraft(request: WriteDraftRequest): Promise<DocumentDraft> {
  const response = await authorizedFetch(
    `/v1/admin/legal/documents/${request.kind}/${request.locale}/draft`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: request.title, body: request.body }),
      signal: request.signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as DocumentDraft;
}

export interface PublishRequest {
  readonly kind: DocumentKind;
  /**
   * When the version starts governing. Null means now.
   *
   * A date in the future is the useful case — a change announced a fortnight before it bites
   * — and a date in the past is refused, because backdating what somebody is bound by is the
   * one thing this whole epic exists to prevent.
   */
  readonly effectiveFrom: string | null;
  readonly signal?: AbortSignal;
}

/**
 * Shows readers an already published version instead of the latest one, in every language.
 *
 * Nothing is edited: the version stays exactly as published. The next publication takes over
 * again.
 */
export async function activateVersion(
  kind: DocumentKind,
  version: number,
  signal?: AbortSignal,
): Promise<{ documents: DocumentSummary[] }> {
  const response = await authorizedFetch(
    `/v1/admin/legal/documents/${kind}/versions/${version}/activate`,
    { method: 'POST', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as { documents: DocumentSummary[] };
}

/** Publishes every open draft of this document, in every language, as one version. */
export async function publishDocument(request: PublishRequest): Promise<{ documents: DocumentSummary[] }> {
  const response = await authorizedFetch(`/v1/admin/legal/documents/${request.kind}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ effectiveFrom: request.effectiveFrom }),
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as { documents: DocumentSummary[] };
}
