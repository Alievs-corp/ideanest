# `@ideanest/campaign`

The campaign page's rules with one right answer: which states have a page and which
take pledges, the 80% threshold, the funded percent, the countdown and the days
left, the tabs and their link parameters, the story reader, the live counter's
wire format and reconnect policy, the community lists' readers, and the report
vocabulary — one implementation, for `apps/web` and `apps/mobile`.

```ts
import { acceptsPledges } from '@ideanest/campaign/pledgeable';
import { successThresholdOf } from '@ideanest/campaign/threshold';
import { daysLeftOf } from '@ideanest/campaign/days-left';

acceptsPledges('LIVE', '2026-10-30T12:00:00Z', new Date()); // true until the deadline
successThresholdOf({ amount: '1001.01', currency: 'AZN' });  // { amount: '800.81', … } — ROUND_UP
daysLeftOf('2026-10-03T12:00:00Z', new Date('2026-10-01T12:00:00Z')); // 2
```

## Why this is a package

It used to be `apps/web/src/lib/{projects,realtime,community,obligations,moderation}`.
It moved when the app's campaign screen (#155) needed the same page: the Back pill
has to appear for exactly the campaigns the web offers it on, the trust block has to
name the same threshold to the cent, a live total has to add the same frames, and a
story has to render on a phone if and only if it renders in a browser — the app's
old reader walked a different schema and showed every real story as empty (#140).
Two copies would agree on every case somebody tested by hand and drift on the rest.
CLAUDE.md §3: shared logic is never duplicated.

The web modules re-export what moved under the same names, so no web caller
changed (the pattern of `@ideanest/discovery`, #245). `apps/web/README.md` has the
table of what each web module re-exports and what it kept.

**What is not here**, and why:

- **Requests.** The web reads on the server with cache tags and writes with
  `authorizedFetch`; the app uses the typed `@ideanest/api-client`. How a request is
  sent is the part that genuinely differs.
- **Writing an instant out.** The web formats a deadline twice (UTC on the server,
  the reader's zone after hydration); the app formats it once in the device zone and,
  on Hermes, needs the part-less Azerbaijani path from `@ideanest/messages/hermes`,
  which the web must never bundle.
- **Web addresses and English labels.** `campaignTabHref`, metadata, structured
  data and every word on screen stay with each client; the words are the catalogue's.
- **The socket.** Each client owns its `useCampaignUpdates` hook; both call
  `reconnectDelayMs` from here.

## Modules

| Import | Holds |
|---|---|
| `@ideanest/campaign/states` | `ProjectState` (the nineteen of §6.1), `RENDERABLE_STATES`, `isRenderableState` |
| `@ideanest/campaign/pledgeable` | `PLEDGEABLE_PROJECT_STATES`, `acceptsPledges` (LIVE until its deadline, CLOSING_WINDOW, EXTENDED) |
| `@ideanest/campaign/threshold` | `SUCCESS_THRESHOLD` (0.80), `successThresholdOf` — `ROUND_UP` to the cent, `decimal.js` only |
| `@ideanest/campaign/completion` | `completionOf` — the funded percent, rounded down, `null` without a goal |
| `@ideanest/campaign/deadline` | `Remaining`, `remainingUntil`, `CountdownUnits`, `countdownLabel`, `countdownIntervalMs` |
| `@ideanest/campaign/days-left` | `daysLeftOf` — whole days, floored at zero (a module of its own; see below) |
| `@ideanest/campaign/tabs` | `CampaignTabId`, `CAMPAIGN_TABS` (order), `DEFAULT_CAMPAIGN_TAB`, the `tab` / `from` / `thread` parameter names, `campaignTabFrom`, `campaignCursorFrom` |
| `@ideanest/campaign/story` | The version-1 block and span types, `STORY_SCHEMA_VERSION`, `EMBED_PROVIDERS`, `isEmbedProvider`, `readStoryDocument` |
| `@ideanest/campaign/realtime` | `REALTIME_ORIGIN_VARIABLE`, `counterChannel`, `commentsChannel`, `realtimeUrl`, `CampaignUpdate`, `parseUpdate`, `addToTotal`, and the reconnect policy: `BASE_BACKOFF_MS`, `MAX_BACKOFF_MS`, `MAX_RECONNECT_ATTEMPTS`, `reconnectDelayMs` |
| `@ideanest/campaign/comments` | The comment shapes, `COMMENT_PAGE_SIZE` (10), `CommentPageLocation`, `readCommentPage`, `readComment`, `isSubmittableComment` |
| `@ideanest/campaign/updates` | The update shapes, `UPDATE_PAGE_SIZE` (20), `readUpdatePage` |
| `@ideanest/campaign/faqs` | `CampaignFaq`, `CAMPAIGN_FAQ_LIMIT` (50), `readFaqList` |
| `@ideanest/campaign/obligation` | `OBLIGATION_STATES`, `UpdateObligation`, `readUpdateObligation`, `readCreatorObligations` |
| `@ideanest/campaign/report` | `ReportReason`, `REPORT_REASONS`, `requiresDetail`, `DETAIL_MAX_LENGTH` (2000), `ReportTarget`, `reportPath`, `reportBody` |

The community readers are three modules rather than one `./community`, because
the web kept them as three files and each tab reads one list: the Updates tab has
no reason to carry the comment reader. Like `@ideanest/discovery` there is no barrel
— each module is imported by its own path and the package is `sideEffects: false`,
which matters on the web, whose campaign route has a First Load JS budget with
almost no headroom.

`daysLeftOf` is `./days-left` rather than part of `./deadline` for that budget.
The web computes it on the server and ticks the countdown in a client component;
while one module served both, the admin preview's client graph (which reaches
`readCampaignPage`) shared it with the countdown, the bundler kept it as a
standalone module with every export, and the campaign route went 0.4 KiB over its
ceiling. Split, each side carries only what it calls.

## Runtime

Plain TypeScript over `decimal.js`, `@ideanest/money` and `@ideanest/messages`.
Nothing here touches `window`, `WebSocket`, `URLSearchParams` or React, so it runs
the same in a browser, in a Server Component and on Hermes.

`countdownLabel` declines its units through `pluralise`, which asks
`Intl.PluralRules`. Hermes ships without it; `apps/mobile` loads the
`@formatjs/intl-pluralrules` polyfill before anything translates (see
`apps/mobile/README.md`).

## Tests

`pnpm --filter @ideanest/campaign test` (vitest). The tests moved here with the code;
the ones the web kept test what the web kept.
