# Store listing and submission (`apps/mobile/store`)

Issue #165's store readiness: the listing texts, the privacy answers, and the
gates a submission has to clear. The listing is marketing copy, not UI, so it
lives here and not in `@ideanest/messages`.

| File | What it is |
|---|---|
| `az.json`, `en.json`, `ru.json`, `tr.json` | The listing in four languages, one field per store field |
| `store-config.js` | Builds `../store.config.json` (EAS Metadata, App Store) from the listings |
| `../store.config.json` | Generated. Never edited by hand |
| `data-inventory.md` | What the app collects: the source of App Privacy, Data safety and the iOS privacy manifest |
| `store.test.ts`, `data-inventory.test.ts` | Key parity and length limits; generated file up to date; manifest matches the inventory |

The tests are part of the mobile Jest run (`pnpm --filter @ideanest/mobile test`),
which `.github/workflows/mobile-check.yml` runs on every change, so a listing
over a limit fails CI like any other test. No separate step is needed.

## Fields and limits

| Field | Store | Limit |
|---|---|---|
| `appName` | App Store name, Play title | 30 |
| `subtitle` | App Store subtitle | 30 |
| `promotionalText` | App Store promotional text (changeable without a review) | 170 |
| `description` | App Store description | 4000 |
| `keywords` | App Store keywords, comma-separated, no spaces after commas, app name not repeated | 100 |
| `whatsNew` | App Store "What's New" / Play release notes. **Not sent to the App Store for the first version**, which App Store Connect refuses: `store-config.js`'s `FIRST_VERSION` leaves `releaseNotes` out until 1.0 is live | 4000 (Play: 500 per release) |
| `playShortDescription` | Play short description | 80 |
| `playFullDescription` | Play full description | 4000 |

Limits are counted in characters. Write the copy truthfully: describe only what
the app does today, and the funding rule as the threshold it is (80% of the
goal, full refunds below it), **never** "all-or-nothing"; and never as
investment, a donation or charity — a pledge buys a reward. That holds for the
keywords too (`store.test.ts` refuses the usual words in four languages): a
donation keyword invites the reviewer to read the app as a fundraiser, which
the stores treat under different rules.

## App Store: EAS Metadata, English (U.K.) primary

**App Store Connect has no Azerbaijani localisation.** Checked on 2026-10-08
against Apple's [App Store localizations](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations)
reference: the list runs from Arabic to Vietnamese and includes Russian and
Turkish, not Azerbaijani; Apple's default listing language for Azerbaijan is
English (U.K.). So:

- **Proposed primary language: English (U.K.)** — the owner confirms when the
  app record is created (the primary language cannot be removed later, only
  replaced). Russian and Turkish are added as further localisations.
- The Azerbaijani text ships **in the app** (it is the app's default language)
  and **on Google Play**, which supports `az-AZ`. `az.json` is kept for both.

`store-config.js` writes `en-GB`, `ru` and `tr` into `store.config.json`, with
the marketing, support and privacy-policy URLs under `https://ideyanest.com/<locale>`.
After editing a listing:

```
node apps/mobile/store/store-config.js      # regenerate store.config.json
cd apps/mobile && eas metadata:push         # upload to App Store Connect
```

Generated JSON rather than `store.config.js`: EAS reads `store.config.json` by
default, while a JS config needs a `metadataPath` in `eas.json`'s submit profile
and code running at submit time. The JSON is reviewable in the pull request
exactly as App Store Connect will receive it, and `store.test.ts` keeps it level
with the listings. Not in the file, on purpose: `apple.review` (demo account
credentials — never in this repository), `copyright` and `categories` (the
owner's legal name and the category are decisions, set once in App Store
Connect), `advisory` (the age-rating questionnaire, below).

## Google Play: by hand for the first release

Play Console → *Grow users → Store presence → Main store listing*, one
translation per language: `az-AZ` from `az.json`, `en-GB` from `en.json`
(default), `ru-RU` from `ru.json`, `tr-TR` from `tr.json`. Title ←
`appName`, short description ← `playShortDescription`, full description ←
`playFullDescription`; release notes ← `whatsNew` on each release.

By hand rather than `fastlane supply`: the listing changes a few times a year,
and `supply` needs Ruby, fastlane, and a Play service-account JSON key with
listing rights stored as a CI secret — a credential that can rewrite the store
page. Revisit when the listing changes per release; `supply`'s layout
(`fastlane/metadata/android/<locale>/{title,short_description,full_description}.txt`)
can be generated from these files the way `store.config.json` is.

## Privacy answers

`data-inventory.md` is the single table. Answer **App Privacy** (App Store
Connect) and **Data safety** (Play Console) row by row from it; the iOS manifest
is built from the same rows and a test holds them level. Crash diagnostics are
declared only for a build with `IDEANEST_SENTRY_DSN`. Before submitting:
archive the production build, run Xcode's *Generate Privacy Report*, and
compare it with the table — the required-reason reasons in particular are only
proven by that report.

## Store-gate checklist

State on 2026-10-08. Each line is **resolved** or **blocked**, with what
blocks it. Nothing here is submitted until every line is resolved.

| Gate | Rule | State |
|---|---|---|
| Account deletion | App Store 5.1.1(v); Play account-deletion policy | **Resolved in the app**: Settings → Privacy → "Data and closure" (`src/features/settings/privacy/privacy-screen.tsx`, ported in #161). **Blocked for Play by #325**: Play also wants a web URL, and `https://ideyanest.com/<locale>/settings/privacy` is sign-in-gated. #325 decides between that page and a public deletion-request page |
| Sign in with Apple | App Store 4.8 | **Resolved by construction**: Google appears on iOS only when Apple does (`IDEANEST_APPLE_SIGN_IN=true`, `src/lib/providers.ts`). A build that sets Google's iOS client must also set Apple, and the capability must be on the App ID. Google on Android is not offered yet (#241); Apple does not apply there |
| UGC: report | App Store 1.2 | **Resolved**: campaigns and comments have the report sheet (`src/components/campaign/report-sheet.tsx`, the web's `ReportControl` vocabulary) |
| UGC: block an abusive user | App Store 1.2 | **Blocked by #324.** No block feature exists on the web, the API or the app; #324 decides what blocking hides (comments, messages, the creator's campaigns) and builds it |
| UGC: published contact details | App Store 1.2 | **Blocked by #325**: the support URL in `store.config.json` is `/<locale>/about`, which must show a support email or form before submission. No support address exists in the repository |
| Plan subscriptions | App Store 3.1.1, Play payments policy | **Blocked on the owner's decision**: `IDEANEST_IN_APP_PLAN_CHOICE` stays unset until store billing vs. an exemption is decided (see "Pricing" in `../README.md`). Unset, plans are chosen on the web — acceptable only if the app does not link to that purchase |
| Pledges and real-world rewards | App Store 3.1.5 | **Review note needed**: explain that a pledge buys a physical or real-world reward from a third-party creator and is paid on the provider's page |
| Demo accounts and review notes | App Store review, Play app access | **Open**: a demo backer and a demo creator on production, credentials **only** in App Store Connect review notes and Play Console "App access" — never in this repository, `store.config.json` included |
| Privacy policy | App Store 5.1.1, Play user data policy | **Blocked by #325**: `legal/privacy-policy` must cover the app's collection (`data-inventory.md`) and name every processor — the payment provider, Expo (push and EAS Update), and the crash-reporting destination once one is chosen |
| Age rating | Both stores | **Open**: answer Apple's questionnaire and Play's IARC questionnaire. User-generated content with moderation and reporting, no gambling or mature themes in the app itself; the content policy (`docs/architecture.md` §5.4) decides the answers |
| Export compliance | App Store | **Resolved**: `ITSAppUsesNonExemptEncryption: false` (HTTPS and the OS keychain only) |
| Content rights | App Store | **Open**: confirm the platform has rights to show creators' content (the creator agreement) when App Store Connect asks |
| Crash-reporting destination | #165 | **Resolved (2026-10-08):** sentry.io, EU region, DSN in `eas.json`. The privacy policy must name it (#325) |
| Screenshots, feature graphic | Both stores | Not in this directory's scope: generated by the Maestro flow `apps/mobile/e2e/maestro/screenshots.yaml` and, for the feature graphic, from the tokens (`scripts/generate-assets.mjs`) (#165) |
