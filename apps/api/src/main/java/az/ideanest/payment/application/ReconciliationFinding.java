package az.ideanest.payment.application;

import az.ideanest.ledger.application.LedgerAccount;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * One thing the reconciliation found wrong — issues #70 and #403.
 *
 * <p>A finding is a sentence somebody has to act on. The kind is what a metric counts and an
 * alert routes on; {@link #detail} is what the person woken by that alert reads first, and it
 * carries the figures rather than pointing at a query they would have to write.
 *
 * <h2>It carries its parts as well as its sentence, and that is #403</h2>
 *
 * <p>This record held {@code kind}, {@code currency} and {@code detail}, and said so at
 * length: "no account identifier, no campaign, no amount as a separate field — they are in
 * the detail where they belong: this is a log line and a health row, not a table somebody
 * joins against".
 *
 * <p>That was true of the two readers it had. It stopped being true when {@code
 * /admin/reconciliation} became the third, because a console screen renders to a person in
 * their own language and an English sentence with a raw UUID and an unformatted amount in it
 * is the only part of that screen carrying the actual result. A prose-only finding cannot be
 * translated by anybody, which made the sentence the API's opinion about what Azerbaijani
 * reads like.
 *
 * <p>So the parts travel beside the sentence: {@link #code} says which of the four shapes this
 * is — {@link Kind} cannot, because two of them are {@code IMPOSSIBLE_SIGN} and read in
 * opposite directions — and the console builds its own sentence from the parts, with the
 * account named and the money formatted the way every other figure on the platform is. The
 * detail is unchanged and is still what the log line prints, because a log line in the
 * reader's language would be a log line nobody can grep.
 *
 * @param code which of the four checks produced this, and therefore which sentence it is
 * @param account the ledger account it is about — {@code escrow}, {@code creator:<id>} — or
 *     null for the two findings that are about a whole currency rather than one position
 * @param currency the currency the discrepancy is in. §21.2 refuses to add two, so a finding
 *     is always about exactly one
 * @param amount the figure the sentence turns on: the net that should have been zero, the
 *     balance whose sign is impossible, or the ledger's side of a disagreement
 * @param otherAmount the second figure, for the one finding that compares two — the payments'
 *     side of {@link Code#DISAGREES_WITH_PAYMENTS}. Null everywhere else
 * @param detail what is wrong, with the numbers in it, in English. The log line
 */
public record ReconciliationFinding(
        Code code, String account, String currency, BigDecimal amount, BigDecimal otherAmount, String detail) {

    /** What kind of thing went wrong, which is what an alert is routed on. */
    public enum Kind {
        /** The debits do not equal the credits. V41's trigger should make this impossible. */
        UNBALANCED,
        /** An account holds a balance whose sign cannot be true — see the checks. */
        IMPOSSIBLE_SIGN,
        /** The ledger and the transaction records disagree about what the platform holds. */
        DISAGREES_WITH_PAYMENTS
    }

    /**
     * Which check produced the finding, one value per sentence.
     *
     * <p>Finer than {@link Kind} deliberately. Two of these are {@code IMPOSSIBLE_SIGN} and
     * say opposite things — a creator paid more than they earned, and platform money
     * disbursed that was never taken — so a reader given only the kind would be given the
     * severity and not the meaning.
     */
    public enum Code {
        /** Summed across every account in one currency, the ledger is not zero. */
        LEDGER_NOT_ZERO(Kind.UNBALANCED),
        /** A creator's account is positive: they hold a claim the platform already paid. */
        CREATOR_OVERPAID(Kind.IMPOSSIBLE_SIGN),
        /** One of the platform's own accounts is negative: money out that never came in. */
        PLATFORM_ACCOUNT_NEGATIVE(Kind.IMPOSSIBLE_SIGN),
        /** The ledger's view of what is held and the transactions' view do not agree. */
        DISAGREES_WITH_PAYMENTS(Kind.DISAGREES_WITH_PAYMENTS);

        private final Kind kind;

        Code(Kind kind) {
            this.kind = kind;
        }

        public Kind kind() {
            return kind;
        }
    }

    /** What an alert routes on. Derived, so the two can never disagree. */
    public Kind kind() {
        return code.kind();
    }

    /** The ledger does not sum to zero in this currency. */
    public static ReconciliationFinding ledgerNotZero(String currency, BigDecimal net) {
        return new ReconciliationFinding(
                Code.LEDGER_NOT_ZERO,
                null,
                currency,
                net,
                null,
                "The ledger does not sum to zero: net %s".formatted(net.toPlainString()));
    }

    /** A creator's account is positive, which is a creator paid more than they earned. */
    public static ReconciliationFinding creatorOverpaid(String account, String currency, BigDecimal balance) {
        return new ReconciliationFinding(
                Code.CREATOR_OVERPAID,
                account,
                currency,
                balance,
                null,
                "%s is positive at %s, which is a creator paid more than they earned"
                        .formatted(account, balance.toPlainString()));
    }

    /** A platform account is negative, which is money disbursed that was never taken. */
    public static ReconciliationFinding platformAccountNegative(
            String account, String currency, BigDecimal balance) {

        return new ReconciliationFinding(
                Code.PLATFORM_ACCOUNT_NEGATIVE,
                account,
                currency,
                balance,
                null,
                "%s is negative at %s, which is money disbursed that was never taken"
                        .formatted(account, balance.toPlainString()));
    }

    /**
     * #587: one campaign holds less than nothing — it returned or paid out more than it took, and no
     * creator debt answers for it. Escrow read as one pool hides this behind every other campaign.
     *
     * <p>{@link Code#PLATFORM_ACCOUNT_NEGATIVE}, because that is what it is: escrow below zero, for one
     * campaign. The account is {@code escrow:<campaign>}, which the console prints as it is.
     */
    public static ReconciliationFinding campaignEscrowNegative(UUID projectId, String currency, BigDecimal held) {
        String account = LedgerAccount.ESCROW.name() + ":" + projectId;
        return new ReconciliationFinding(
                Code.PLATFORM_ACCOUNT_NEGATIVE,
                account,
                currency,
                held,
                null,
                ("%s holds %s with its provider and bank fees put back, which is money returned or paid out for"
                                + " campaign %s beyond what it took, and no creator debt covers it")
                        .formatted(account, held.toPlainString(), projectId));
    }

    /** The ledger and the transactions disagree about what the platform holds. */
    public static ReconciliationFinding disagreesWithPayments(
            String currency, BigDecimal ledgerSide, BigDecimal paymentSide) {

        return new ReconciliationFinding(
                Code.DISAGREES_WITH_PAYMENTS,
                null,
                currency,
                ledgerSide,
                paymentSide,
                "The ledger holds %s and the transactions say %s"
                        .formatted(ledgerSide.toPlainString(), paymentSide.toPlainString()));
    }
}
