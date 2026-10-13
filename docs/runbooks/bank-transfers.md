# Runbook — paying creators by bank transfer

**You are reading this because a payout in the console says "Transfer by hand".** The
creator is paid into a bank account (an IBAN), so nothing goes through the payment
provider: you transfer the money from IdeyaNest's own bank account and then record the
transfer in the console from the bank statement. Start at
[§2, Paying a payout](#2-paying-a-payout).
A backer's refund waiting for a bank transfer is
[§6](#6-refunds-past-the-providers-refund-window).

| | |
|---|---|
| Owner | Finance operations |
| Who can do it | A member of staff holding `APPROVE_PAYOUT` and `READ_BANK_DETAILS` — today, `SUPER_ADMIN` |
| Where | The console, `/admin/payouts` |
| Related | `docs/architecture.md` §6.3 (payouts, "A creator paid into an IBAN is paid by a person") and §9.5 (money flow); issues #392, #397, #398 |

---

## 1. Before you start

- **The payout is approved.** It shows the tag *Approved* and every signature it needs. A
  payout above the dual-approval threshold needs two different people; the console says how
  many more it needs.
- **The creator's account is confirmed.** A compliance reviewer verified it on
  `/admin/payout-destinations`, or an exception was granted. The console will not start a
  transfer to an account nobody confirmed.
- **No backer's dispute on the campaign is open.** Decide open disputes first on
  `/admin/disputes`: once a transfer starts, no dispute on the campaign can be upheld.
- **It is not your own campaign.** Nobody pays their own payout; ask a colleague.

## 2. Paying a payout

1. **Open the payout** on `/admin/payouts` and find the *Transfer by hand* panel. It replaces
   the Send button for these payouts.
2. **Press *Start the transfer*.** The service checks everything again — the signatures, that
   the campaign has not already been paid, that the figures have not moved since the payout
   was calculated, that the account is still confirmed — and then shows:
   - the **amount to transfer**, with its currency,
   - the **IBAN**, in groups of four,
   - the **account holder**,
   - the **payment description** (`IdeyaNest payout <payout id>`).

   Each has a *Copy* control. The amount copies as a plain decimal (`1250.00`), ready for the
   bank's form.

   Opening the account is recorded in the audit trail under your name, every time, and the
   console does not keep it: once you hide it or leave the page it is gone. *Show the account
   again* reads it again, and that is audited too.
3. **Make the transfer in IdeyaNest's online banking.** Use exactly the amount, currency,
   IBAN, holder name and payment description shown. The description is how the statement line
   is matched to the payout later — do not shorten it.
4. **Wait for the statement.** Do not record anything until the transfer appears on the bank
   statement with a reference and a value date.
5. **Record the transfer** in the same panel:
   - **Bank reference** — exactly as the statement shows it.
   - **Value date** — as the statement shows it. It defaults to today in Baku and must be
     between the day the transfer was started and today.
   - **Bank fee** — what the bank charged IdeyaNest for the transfer, as the statement shows
     it, or blank if it charged nothing. A comma or a point is fine (`1,20`), at most two
     decimal places. It is the platform's cost, posted to `platform_expense`; it does not
     change what the creator receives.
   - **Note** — what you checked (for example the statement line). It is kept in the audit
     trail and is required.

   Press *Record the transfer*, read the confirmation (amount, reference, date, and the bank
   fee if you entered one), and confirm.
   **This cannot be undone**: the payout becomes *Paid*, the ledger records the payout — the
   creator's account closed, the net out of escrow, the platform fee and the bank fee beside
   it — and any
   debt withheld from the creator is recovered. The creator is told, by email, push and in the
   app, the amount, the value date you entered and the account's first and last four
   characters — so enter the date exactly as the statement shows it.

While a transfer is in progress the console shows *Transfer in progress* on the row, who
started it and when. The payout cannot be cancelled and no signature can be withdrawn until it
is recorded or abandoned, because the money may already have left.

## 3. When the transfer was not made

If the transfer was started in the console but the money **never left** IdeyaNest's account —
the bank rejected the order, or it was never submitted — press *Abandon the transfer* and say
in the note how you know (for example "no debit on the statement for 2026-10-12"). The payout
goes back to *Approved* and can be started again, cancelled or recalculated.

**Never abandon a transfer that was made.** Abandoning lets the campaign be priced and paid a
second time. A transfer that left the account is recorded, even if something about it looks
wrong; then escalate (see §5).

## 4. What the console's refusals mean

| The console says | What to do |
|---|---|
| The destination is a provider's token, not a bank account | The creator is paid through the provider. Use *Send*. |
| A backer's dispute on this campaign is still undecided | Decide it on `/admin/disputes`, then start again. |
| The figures moved, so the payout has been cancelled | A refund or collection changed the campaign's totals. The open file and its row now show the payout as cancelled; it leaves the queue on its next read. Calculate a new payout for the campaign and have it approved again. |
| The creator's account is not confirmed | Ask compliance to review it on `/admin/payout-destinations`. |
| Nobody pays their own payout | A colleague has to handle it. |
| Already recorded under a different bank reference | Somebody recorded it already. Check the statement and the audit trail before doing anything else. |
| Another settled transaction already carries this reference | The reference was typed wrongly or belongs to another payment. Check the statement line. |
| The value date has to be between … and … | Use the date on the statement; it cannot be before the day the transfer started or after today (Baku). |
| A bank transfer of this payout is in progress | Record it or abandon it before cancelling or withdrawing a signature. |
| Needs `APPROVE_PAYOUT` / `READ_BANK_DETAILS` | Ask an administrator; these are `SUPER_ADMIN` capabilities. |

## 5. Escalate to engineering when

- a transfer was recorded with the wrong reference or date — there is no correction in the
  console;
- the bank returns money for a transfer that is already recorded;
- a refund was issued on the campaign after the transfer started. Recording still succeeds,
  and the service logs the difference (`refundedSincePriced`); it has to be recovered from the
  creator by hand.

## 6. Refunds past the provider's refund window

**You are here because a refund in the console says *Waiting for bank details* or *Waiting
for transfer*.** The backer's card payment is older than the payment provider's refund
window, so the money cannot go back to the card. It is owed to the backer all the same:
support records the bank account the backer gives, and finance transfers the money from
IdeyaNest's own bank account and records the transfer from the bank statement.

| | |
|---|---|
| Who records the account | A member of staff holding `HANDLE_SUPPORT` — `MODERATOR`, `FINANCE`, `SUPER_ADMIN` — on `/admin/support`, or on the refund's row on `/admin/refunds` for those who can read it |
| Who transfers and records it | A member of staff holding `ISSUE_REFUND` — `FINANCE`, `SUPER_ADMIN` — on `/admin/refunds`, **and not the person who recorded the account** |
| Related | `docs/architecture.md` §9.7 ("Past the provider's refund window") and §9.8; issues #392, #399, #400, #416 |

### 6.1 How a refund ends up here

- **Automatically.** A refund of a charge older than the provider's refund window (§6.6) is
  never sent to the provider. It is recorded *Waiting for bank details*, and the backer is
  notified, by email and in the app, that their refund needs their bank details. The
  notification links to their pledge, which says "Refund pending — contact support", the
  amount and the pledge's reference, and opens WhatsApp with a message quoting the pledge.
- **By hand, from a refused refund.** When the provider refuses a refund for a reason the
  platform does not recognise as "too old", the refund is *Failed*. On `/admin/refunds` a
  member of finance presses *Refund by bank transfer* on that row and confirms. A new refund,
  *Waiting for bank details*, is created for what the charge still has left. Pressing it
  again answers the same refund; it never creates a second one.

Until the transfer is recorded, the refunded amount already counts as gone: the campaign's
refunds do not offer it again and the creator's payout subtracts it. The creator's financial
summary says so under *Refunded to backers*.

### 6.2 Support: recording the backer's account

1. **Get the account from the backer.** They write to support — today on WhatsApp, where the
   pledge page has already written the pledge's reference into the message. You need the
   **IBAN** and the **name of the account holder**, exactly as the bank has them. **Never ask
   for card details**, and never take an account from anybody but the backer.
2. **Open a ticket for the backer about that pledge.** A backer cannot open one themselves, so
   you do it in their name, from the pledge's reference they quoted:
   - on `/admin/refunds`, choose *Waiting for bank details* and press *Open the backer's ticket
     and record their account* on the refund's row; or
   - on `/admin/support`, press *Open a ticket for a backer* and paste the pledge's full
     identifier.

   Write down **what the backer said, and where and when** — for example the WhatsApp message
   and its date — and press *Open ticket*. The ticket is raised for whoever made the pledge, so
   you never choose the person, and the audit trail records that you raised it. If the backer
   already has a ticket about the pledge, use that one instead: the account must be recorded
   from a ticket the pledge's backer raised, and the service refuses any other.
3. **Press *Record a refund bank account*** — from the refund's row the form is already open —
   and fill in:
   - **IBAN** — any country's. Spaces are fine; the console groups it in fours and checks it,
     so a mistyped character or two swapped ones are caught before anything is sent.
   - **Account holder** — as the backer wrote it.
   - **Support ticket** — prefilled with the ticket you opened or are reading. Leave it unless
     the backer gave the account in another of their tickets.
4. **Press *Record account*.** Every part of the pledge's refund that is waiting moves to
   *Waiting for transfer*, and the console says which account — by its first and last four
   characters — is on file for how much.

To **correct** an account before the transfer is made, record it again from the pledge's
ticket. The new account replaces the old one, and the audit trail keeps both hints.

**You cannot record the transfer yourself** once you have recorded the account. That is
deliberate: no one person both chooses where a refund goes and confirms that it was paid.

### 6.3 Finance: making and recording the transfer

1. **Open `/admin/refunds`** and choose *Waiting for transfer*. Each row shows the account's
   hint, the ticket it came from, and who recorded it and when. If you recorded the account
   yourself, the row says so instead of offering anything: ask a colleague.
2. **Press *Reveal account*.** The console shows:
   - the **amount to transfer**, with its currency — the charge's currency, which is the one
     the transfer is made in;
   - the **IBAN**, in groups of four;
   - the **account holder**.

   Each has a *Copy* control. The amount copies as a plain decimal (`25.00`), ready for the
   bank's form. Opening the account is recorded in the audit trail under your name, every
   time, and the console does not keep it: once you hide it or leave the page it is gone.
3. **Make the transfer in IdeyaNest's online banking**, with exactly that amount, currency,
   IBAN and holder name. Put the pledge's reference in the payment description so the
   statement line can be matched to the refund.
4. **Wait for the statement.** Do not record anything until the transfer appears on the bank
   statement with a reference and a value date.
5. **Record the transfer** in the same row:
   - **Bank reference** — exactly as the statement shows it.
   - **Value date** — as the statement shows it. It defaults to today in Baku and cannot be
     after today.
   - **Bank fee** — what the bank charged for the transfer, or blank. The backer still gets
     the whole refund; the fee is the platform's cost (`platform_expense`).

   Press *Record transfer*, read the confirmation (amount, account, date, reference, and the
   bank fee if any), and press *Record it*. **This cannot be undone**: the refund becomes
   *Succeeded*, the ledger records it (debit `refunds`, credit `escrow`, and the bank fee from
   escrow to `platform_expense`), and the pledge becomes *Refunded* when
   nothing is left on it. Recording the same reference again changes nothing. The backer is
   told, by email, push and in the app, the amount, the value date you entered and the
   account's first and last four characters; if one transfer paid several parts of the pledge,
   they get one message per part.

### 6.4 What the console's refusals mean

| The console says | What to do |
|---|---|
| The charge is in an open chargeback | **Transfer nothing.** The card network may already be returning the money. Wait until the chargeback is decided on `/admin/disputes`, and escalate before transferring if it was decided for the backer. |
| You recorded this backer's bank account, so somebody else in finance must record the transfer | A colleague records it. |
| That bank reference is already recorded for another backer's refund | The reference was typed wrongly or belongs to another payment. Check the statement line. |
| The value date is in the future | Use the date on the statement. |
| This refund is no longer waiting for a transfer | Somebody recorded it already, or the account is not on file yet. Reload and check the row and the audit trail. |
| Only a refund the provider refused can be sent by bank transfer | The refund is not *Failed* any more. Reload the list. |
| This ticket was not raised by the pledge's backer | Record the account only from the backer's own ticket about this pledge. |
| Nothing on this pledge is waiting to be refunded by bank transfer | There is no refund to attach an account to. Check `/admin/refunds` for the pledge. |
| No pledge has that identifier | The identifier was mistyped or cut short. Check it against what the backer sent. |
| … encrypted storage is not configured | The `bank-details` keyring is missing on this deployment (§6.6). Escalate. |
| Needs `ISSUE_REFUND` / `HANDLE_SUPPORT` | Ask an administrator for the role. |

### 6.5 Escalate to engineering when

- a refund transfer was recorded with the wrong reference or date — there is no correction in
  the console;
- the bank returns a refund transfer that is already recorded;
- a chargeback arrives on a charge already refunded by bank transfer (the service logs it at
  ERROR): the backer may be paid twice.

### 6.6 Configuration

- `IDEANEST_PAYMENT_REFUNDS_WINDOWS_PAYRIFF` — the provider's refund window, for example
  `P28D`. Unset means no window, and no refund is routed here automatically. Set it only once
  every node runs the release that knows the two new refund states (#399).
- `IDEANEST_CRYPTO_BANKDETAILS_PRIMARYKEYID` and `IDEANEST_CRYPTO_BANKDETAILS_KEYS_<LABEL>` —
  the `bank-details` keyring the IBAN is sealed under. Without it, recording and revealing an
  account are refused with "encrypted storage is not configured".
- `PAYRIFF_REFUND_WINDOW_CLOSED_CODES` and `PAYRIFF_REFUND_WINDOW_CLOSED_MESSAGES` — how
  Payriff says "too old to refund". The defaults are Payriff's confirmed answer (#417): code
  `01000` whose message contains "Refund time expired". Set them only if Payriff changes it.
  Any other refusal is *Failed* and is routed by hand (§6.1).
