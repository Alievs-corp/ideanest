package az.ideanest.shared.compliance;

import java.util.Objects;

/**
 * A creator's bank account, opened for a member of staff who is about to pay into it —
 * epic #392, issue #394.
 *
 * <p>The only shape in which a full IBAN leaves the compliance module, and only through
 * {@link PayoutDestinations#revealBankAccount}, which checks the capability and audits the
 * opening before it returns one.
 *
 * @param iban the account number, normalised: upper case, no spaces
 * @param holderName who the creator says holds it, as matched against their legal name
 * @param displayHint the masked form, such as {@code AZ21…1944}: what a log line, an audit
 *     row or a list may contain instead of {@code iban}
 */
public record BankAccount(String iban, String holderName, String displayHint) {

    public BankAccount {
        Objects.requireNonNull(iban, "A bank account has a number");
        Objects.requireNonNull(holderName, "A bank account has a holder");
    }

    /** The hint, never the number: a record logged by accident must not put an IBAN in a log. */
    @Override
    public String toString() {
        return "BankAccount[" + displayHint + "]";
    }
}
