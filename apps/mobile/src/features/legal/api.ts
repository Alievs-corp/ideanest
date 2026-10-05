import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import {
  kindOf,
  readLegalCatalogue,
  readLegalDocument,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalDocumentSummary,
  type LegalRead,
} from '@ideanest/legal/documents';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';

/**
 * The legal reads — issue #164, the web's `lib/legal/server.ts`.
 *
 * <h2>404 is an answer; everything else is a failure</h2>
 *
 * A 404 is the service saying no version of the document is in force, and it is data: the page
 * says "not published" and the answer is cached like any other. A 5xx, a timeout, no network or
 * a body that does not narrow is thrown, so the screen shows an error with a retry — never "not
 * published", which during an outage would tell a reader IdeyaNest has no terms of use (#147).
 *
 * An hour fresh, as the web revalidates them; not retried, because the reader has a retry and a
 * pull to refresh, and a legal text is not worth three silent round trips on a bad connection.
 */
const STALE_MS = 60 * 60 * 1000;

/** A response the shared narrowing refused — a failure, not a missing document. */
export class UnreadableLegalResponse extends Error {
  constructor() {
    super('The legal document response could not be read');
    this.name = 'UnreadableLegalResponse';
  }
}

export type LegalAnswer = Exclude<LegalRead<LegalDocument>, { readonly state: 'unavailable' }>;

async function answerOf(read: () => Promise<unknown>): Promise<LegalAnswer> {
  let body: unknown;
  try {
    body = await read();
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return { state: 'unpublished' };
    throw cause;
  }
  const document = readLegalDocument(body);
  if (document === null) throw new UnreadableLegalResponse();
  return { state: 'published', document };
}

export function useLegalCatalogue(locale: string) {
  return useQuery({
    queryKey: queryKeys.legalCatalogue(locale),
    staleTime: STALE_MS,
    retry: false,
    queryFn: async ({ signal }): Promise<readonly LegalDocumentSummary[]> => {
      const catalogue = readLegalCatalogue(
        await api().get('/v1/legal/documents', { query: { locale }, signal }),
      );
      if (catalogue === null) throw new UnreadableLegalResponse();
      return catalogue;
    },
  });
}

export function useLegalDocument(slug: LegalDocumentSlug, locale: string) {
  const kind = kindOf(slug);
  return useQuery({
    queryKey: queryKeys.legalText(kind, locale),
    staleTime: STALE_MS,
    retry: false,
    queryFn: ({ signal }) =>
      answerOf(() => api().get('/v1/legal/documents/{kind}', { path: { kind }, query: { locale }, signal })),
  });
}

/** Never called with a version `archivedVersionOf` refused: the route says not found first. */
export function useArchivedLegalDocument(slug: LegalDocumentSlug, version: number, locale: string) {
  const kind = kindOf(slug);
  return useQuery({
    queryKey: queryKeys.legalArchived(kind, locale, version),
    staleTime: STALE_MS,
    retry: false,
    queryFn: ({ signal }) =>
      answerOf(() =>
        api().get('/v1/legal/documents/{kind}/versions/{version}', {
          path: { kind, version },
          query: { locale },
          signal,
        }),
      ),
  });
}
