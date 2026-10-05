# `@ideanest/legal`

The eight legal documents (§22.2) as both clients read them — `apps/web` and `apps/mobile`
(#164). One statement of the closed set, so a link either app generates is one the other resolves.

| Module | Contents |
|---|---|
| `./documents` | `LEGAL_DOCUMENTS` in §22.2's order, `LegalDocumentSlug`, `LegalDocumentKind`, `isLegalDocumentSlug`, `kindOf`, `legalPath`, `archivedVersionOf` (the `/v/{n}` segment rule), `readLegalDocument`, `readLegalCatalogue`, `LegalRead` with `LEGAL_UNPUBLISHED` / `LEGAL_UNAVAILABLE`, and `paragraphsOf` (a plain-text body split on blank lines) |

Import by subpath only. There is no root entry, so a web bundle pulls in exactly the module it
names.

Nothing here fetches or reads a catalogue: the web's server reads (`apps/web/src/lib/legal/server.ts`)
and the app's queries stay with each client, and the words stay in `@ideanest/messages`.
