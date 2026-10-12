package az.ideanest.compliance.api;

import az.ideanest.compliance.domain.DestinationVerificationMethod;
import az.ideanest.compliance.domain.PayoutDestination;
import az.ideanest.shared.compliance.BankAccount;
import az.ideanest.shared.compliance.DestinationKind;
import az.ideanest.shared.compliance.DestinationStanding;
import az.ideanest.shared.compliance.RejectionReason;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Where a creator is paid, as the two screens that show it need it — part of issue #432. */
public final class PayoutDestinationResponses {

    private PayoutDestinationResponses() {
    }

    /**
     * The creator's own view.
     *
     * <p><strong>The token is not in it.</strong> Not because the creator may not know their
     * own account — they have it in front of them — but because a response carrying it puts it
     * in a browser cache, a proxy log and a bug report, and there is nothing the screen can do
     * with the value that {@code displayHint} does not do better.
     *
     * @param recorded whether anything is on file. A separate boolean rather than a null
     *     {@code standing}, so that the client's empty state is a field it reads rather than a
     *     null check it might forget
     * @param standing where this leaves a payout, override included — the same value the gate
     *     reads, so the screen cannot disagree with it
     * @param rejectionReason set only when a reviewer refused it, from V58's closed set so the
     *     client can translate it into each of §21.1's four languages
     * @param kind a provider token or a bank account (#394); null when nothing is on file. For a
     *     bank account {@code displayHint} is the masked IBAN, such as {@code AZ21…1944}, and the
     *     number itself is never in this response either
     * @param cardRegistrationAvailable whether the configured payment provider can register a
     *     payout card (#394), so the screen offers that route only when it can work. The IBAN
     *     form is always offered
     */
    public record Mine(
            boolean recorded,
            DestinationStanding standing,
            DestinationKind kind,
            String provider,
            String holderName,
            String displayHint,
            RejectionReason rejectionReason,
            Instant verifiedAt,
            Instant updatedAt,
            boolean cardRegistrationAvailable) {

        public static Mine of(PayoutDestination row, DestinationStanding standing, boolean cardRegistrationAvailable) {
            return new Mine(
                    true,
                    standing,
                    row.kind(),
                    row.getProvider(),
                    row.getHolderName(),
                    row.getDisplayHint(),
                    row.rejection().orElse(null),
                    row.getVerifiedAt(),
                    row.getUpdatedAt(),
                    cardRegistrationAvailable);
        }

        /** Nothing on file. {@link DestinationStanding#NONE}, said explicitly. */
        public static Mine none(boolean cardRegistrationAvailable) {
            return new Mine(
                    false, DestinationStanding.NONE, null, null, null, null, null, null, null, cardRegistrationAvailable);
        }
    }

    /**
     * A reviewer's view of one creator's destination.
     *
     * <p>Carries {@code verifiedBy} and {@code verificationMethod}, which the creator's view
     * does not: the creator needs to know that their account was accepted, and a reviewer needs
     * to know who accepted it and on what evidence — which is the question #432 asks the method
     * column to answer years later.
     *
     * <p>Still no token. A screen that displayed it would make every reviewer's browser a place
     * one had been.
     */
    public record ForStaff(
            UUID creatorId,
            boolean recorded,
            DestinationStanding standing,
            DestinationKind kind,
            String provider,
            String holderName,
            String displayHint,
            RejectionReason rejectionReason,
            DestinationVerificationMethod verificationMethod,
            UUID verifiedBy,
            Instant verifiedAt,
            Instant updatedAt) {

        public static ForStaff of(UUID creatorId, PayoutDestination row, DestinationStanding standing) {
            return new ForStaff(
                    creatorId,
                    true,
                    standing,
                    row.kind(),
                    row.getProvider(),
                    row.getHolderName(),
                    row.getDisplayHint(),
                    row.rejection().orElse(null),
                    row.verifiedHow().orElse(null),
                    row.getVerifiedBy(),
                    row.getVerifiedAt(),
                    row.getUpdatedAt());
        }

        public static ForStaff none(UUID creatorId) {
            return new ForStaff(
                    creatorId, false, DestinationStanding.NONE, null, null, null, null, null, null, null, null, null);
        }
    }

    /**
     * A creator's IBAN in full, for a member of staff holding {@code READ_BANK_DETAILS} — #394.
     *
     * <p>The one response that carries an account number, which is why it is its own endpoint
     * rather than a field on {@link ForStaff}: opening it is a separate, audited act, and a
     * screen that loaded the number with the panel would have disclosed it to everybody who
     * looked at the panel.
     *
     * <p>Named for what it is rather than {@code Account}, which the contract already has and
     * which the generated schema would silently have merged this into.
     */
    public record RevealedBankAccount(UUID creatorId, String iban, String holderName, String displayHint) {

        public static RevealedBankAccount of(UUID creatorId, BankAccount account) {
            return new RevealedBankAccount(creatorId, account.iban(), account.holderName(), account.displayHint());
        }

        @Override
        public String toString() {
            return "RevealedBankAccount[creator=" + creatorId + ", " + displayHint + "]";
        }
    }

    /** COMPLIANCE's queue of destinations waiting on somebody. */
    public record Queue(List<ForStaff> destinations) {
    }
}
