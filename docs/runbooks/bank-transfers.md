# Runbook — paying creators by bank transfer

**You are reading this because a payout in the console says "Transfer by hand".** The
creator is paid into a bank account (an IBAN), so nothing goes through the payment
provider: you transfer the money from IdeyaNest's own bank account and then record the
transfer in the console from the bank statement. Start at
[§2, Paying a payout](#2-paying-a-payout).

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
   - **Note** — what you checked (for example the statement line). It is kept in the audit
     trail and is required.

   Press *Record the transfer*, read the confirmation (amount, reference, date), and confirm.
   **This cannot be undone**: the payout becomes *Paid*, the ledger records the payout, and any
   debt withheld from the creator is recovered.

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
| The figures moved, so the payout has been cancelled | A refund or collection changed the campaign's totals. Calculate a new payout for the campaign and have it approved again. |
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

*To be written with #400.* When a backer's refund can no longer go back through the payment
provider, support collects the backer's bank details and the refund is paid by bank transfer
in the same way. The steps for support and finance are added here by issue #400.
