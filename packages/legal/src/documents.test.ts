import { describe, expect, it } from 'vitest';
import {
  archivedVersionOf,
  isLegalDocumentSlug,
  kindOf,
  legalPath,
  LEGAL_DOCUMENTS,
  paragraphsOf,
  readLegalCatalogue,
  readLegalDocument,
} from './documents';

/**
 * §22.2's eight, and the narrowing that keeps a legal page honest — issue #439.
 *
 * <p>The first test is the one that matters most and is the least obvious: this list and the
 * service's `DocumentKind` are the same closed set said twice, and a ninth document is a change
 * to §22.2 rather than a URL somebody can type. If the two ever disagree, an address the footer
 * generates resolves to nothing — which is exactly the failure `navigation.test.ts` refused to
 * allow a legal link at all until this issue closed it.
 */
describe('the document vocabulary', () => {
  it('is §22.2’s eight, and has a kind for every one of them', () => {
    expect(LEGAL_DOCUMENTS).toHaveLength(8);

    for (const slug of LEGAL_DOCUMENTS) {
      // A kind that came back empty would produce a request to
      // `/v1/legal/documents/` — a URL that is not the endpoint and answers the catalogue.
      expect(kindOf(slug)).toMatch(/^[A-Z_]+$/u);
    }
  });

  it('has a distinct kind per document, so two addresses cannot serve one text', () => {
    const kinds = LEGAL_DOCUMENTS.map((slug) => kindOf(slug));
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('narrows an unknown segment, because a ninth document is a specification change', () => {
    expect(isLegalDocumentSlug('terms-of-use')).toBe(true);
    expect(isLegalDocumentSlug('TERMS_OF_USE')).toBe(false);
    expect(isLegalDocumentSlug('anything-else')).toBe(false);
  });

  it('builds the current and archived addresses the same way everywhere', () => {
    // Stated once so that a page cannot generate a link it cannot resolve.
    expect(legalPath('creator-agreement')).toBe('/legal/creator-agreement');
    expect(legalPath('creator-agreement', 3)).toBe('/legal/creator-agreement/v/3');
  });
});

describe('reading a published document', () => {
  const valid = {
    kind: 'TERMS_OF_USE',
    locale: 'az',
    version: 4,
    title: 'İstifadə şərtləri',
    body: 'Bir neçə abzas.\n\nİkinci abzas.',
    contentHash: 'a'.repeat(64),
    effectiveFrom: '2026-03-01T00:00:00Z',
    publishedAt: '2026-02-20T10:00:00Z',
  };

  it('reads a well-formed document', () => {
    expect(readLegalDocument(valid)).toEqual(valid);
  });

  it('refuses an empty body, because a blank page tells a reader they have read the terms', () => {
    /*
     * V65 refuses one, so this can only be a client being handed something it should not have
     * been. Rendering it would be the single worst failure a legal page has: a person who
     * believes they have read a document that does not exist.
     */
    expect(readLegalDocument({ ...valid, body: '' })).toBeNull();
    expect(readLegalDocument({ ...valid, body: '   \n  ' })).toBeNull();
  });

  it.each(['version', 'title', 'contentHash'])('refuses a document with no %s', (field) => {
    const { [field]: _dropped, ...without } = valid as Record<string, unknown>;
    expect(readLegalDocument(without)).toBeNull();
  });
});

describe('reading the catalogue', () => {
  it('drops a row it cannot read and keeps the rest', () => {
    // One unreadable row must not make the index claim the platform has published nothing —
    // which is a stronger statement than "we could not read one of these".
    const catalogue = readLegalCatalogue({
      documents: [
        { kind: 'TERMS_OF_USE', locale: 'az', version: 1, title: 'Şərtlər', effectiveFrom: null },
        { kind: 'PRIVACY_POLICY' },
      ],
    });

    expect(catalogue).toHaveLength(1);
  });

  it('reads an empty catalogue as empty rather than as a failure', () => {
    /*
     * This is the platform's actual state: the machinery exists and the words are #423's
     * adviser's. An empty list means "nothing published", and `null` means "the read failed" —
     * and the index says different things about them.
     */
    expect(readLegalCatalogue({ documents: [] })).toEqual([]);
    expect(readLegalCatalogue(null)).toBeNull();
  });
});

describe('an archived version segment', () => {
  it.each(['1', '7', '99999'])('reads %s as a version', (segment) => {
    expect(archivedVersionOf(segment)).toBe(Number(segment));
  });

  it.each(['0', '00', '07', '100000', 'abc', '3abc', '-1', '1.5', ''])(
    'refuses %j before any request is made',
    (segment) => {
      expect(archivedVersionOf(segment)).toBeNull();
    },
  );
});

describe('the paragraphs of a body', () => {
  it('splits on a blank line and trims each paragraph', () => {
    expect(paragraphsOf('  First.  \n\nSecond.\n')).toEqual(['First.', 'Second.']);
  });

  it('splits on CRLF blank lines as well', () => {
    expect(paragraphsOf('First.\r\n\r\nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('treats a line of whitespace as blank', () => {
    expect(paragraphsOf('First.\n   \t\nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('drops empty pieces, including trailing blank lines', () => {
    expect(paragraphsOf('\n\nFirst.\n\n\n\n\nSecond.\n\n\n')).toEqual(['First.', 'Second.']);
  });

  it('keeps a single line break inside its paragraph', () => {
    expect(paragraphsOf('One line\nand the next.')).toEqual(['One line\nand the next.']);
  });
});

