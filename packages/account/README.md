# `@ideanest/account`

The account rules with one right answer, for `apps/web` and `apps/mobile` (#161, #159, #160, #395):

| Module | Contents |
|---|---|
| `./sessions` | `SessionSummary` (the `GET /v1/auth/sessions` row), `RevokeOutcome`, `browserOf`, `platformOf`, `deviceNameOf` (label, else "Chrome on macOS", else "Unknown device"), `locationOf` |
| `./notifications` | The preference types (`NotificationCategory`, `NotificationChannel`, `DeliveryMode`, `PreferenceSwitch`, `PreferenceChange`), `CATEGORIES` and `CHANNELS` in §4.10's order, `modesFor` (a digest only where `digestOffered`) |
| `./inbox` | One inbox row as both clients read it (#160): `InboxNotification`, `InboxPage`, `InboxCursor` (and `cursorOf`, both halves or none), `NotificationsCopy` (the `account.notifications` tables a client hands in), `describeNotification` (headline and locale-less href from `type + params`), `campaignOf`, `hrefOf` (`NEW_DEVICE_SIGN_IN` → `/settings/sessions`, `REFUND_NEEDS_BANK_DETAILS` and `REFUND_SENT_BY_BANK` → `/pledges/{pledgeId}`, `PAYOUT_DETAILS_NEEDED` and `PAYOUT_SENT` → `/settings/payout`, the three `SUBSCRIPTION_*` types → `/pricing` (#450), else the campaign, else none), `readParams`, the category/channel/mode labels, `mandatoryReason`, `dayKeyOf`/`dayLabelOf`, `groupByDay`, `visibleNotifications` and `isUnread` |
| `./surveys` | The backer survey types (`BackerSurvey`, `SurveyQuestion`, `SurveyAnswer`, `QuestionType`), `orderedQuestions` (by `position`, unpositioned last and stable), `answerFor`, `needsAnAnswer` (open and unanswered) (#159) |
| `./fulfilment` | The delivery row types (`BackerFulfilment`, `Fulfilment`, `FulfilmentStatus`), `describeStatus` (label, sentence and tone from the catalogue's tables), `isFollowableTrackingUrl` (http and https only) (#159) |
| `./iban` | The service's `Iban.java` mirrored (#395): `checkIban` and `checkAzerbaijaniIban` (the electronic form, or the first `IbanDefect` in the service's order), `ibanDefectOf` (a refusal's `meta.defect`), `normaliseIban`, `formatIban` (groups of four, for reading only), and `reformatIban` and `caretAfterFormatting` (one keystroke in a grouped field: the caret stays put, and deleting a grouping space deletes the character beside it). The test reads `Iban.java` and fails when the country table or the defect set drifts |

Import by subpath only. There is no root entry, so a web bundle pulls in exactly the module it
names: the web's first-load JS budgets have no headroom.

The words stay with each client's copy. Nothing here reads a catalogue; a sentence such as
"{browser} on {platform}" is passed in.
