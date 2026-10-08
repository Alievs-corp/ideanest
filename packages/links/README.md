# `@ideanest/links`

Which links on the site open the mobile application, and which screen each one opens (#165,
§4.12 MB-02). One table, read by all three halves of a link, so they cannot drift:

| Reader | What it builds from the table |
|---|---|
| `apps/web/src/lib/mobile/association.ts` | The `apple-app-site-association` `components`: excludes first, then every claimed path bare and under each locale |
| `apps/mobile/app.config.ts` | Android's `intentFilters[0].data`: an allowlist of exact paths and prefixes, none covering `/admin`, plus the empty path for the bare origin |
| `apps/mobile/src/lib/links.ts` | The link handler, through `destinationFor` |

`apps/mobile/scripts/check-association.mjs` fails when the resolved intent filter and the table
disagree (`intentDrift`).

| Module | Contents |
|---|---|
| `./claims` | `CLAIMED_ROUTES` (web paths, app route files, kept query keys, producer), `EXCLUDED_PATHS`, `LOCALES`, `stripLocale`, `appleComponents`, `androidIntentData`, `intentDrift`, `isClaimedPath`, `matchesPattern`, `coversAdmin`, and the closed lists the parser shares with the app (`SETTINGS_PANELS`, `ACCOUNT_SECTIONS`, `EDIT_STEPS`, `DASHBOARD_TABS`) |
| `./destination` | `destinationFor(url, siteHost)`, `Destination`, `NOT_FOUND`, `isNotFound`, `hrefOf` |

`./claims` imports nothing but `@ideanest/messages/locale`. `app.config.ts` and the check script
load it with Node's own loader, which strips types but cannot follow an extensionless relative
import; keep it that way.

## Adding a path

Add a row to `CLAIMED_ROUTES`, teach `destinationFor` the path, and add a sample for the row in
`claims.test.ts` (the test fails until every row has one). The web's association and Android's
intent filter follow on their own; rebuild the app for Android to pick it up. The web test
`association.test.ts` walks `apps/web/src/app/[locale]` and fails for a page that is neither
claimed nor listed as deliberately not.
