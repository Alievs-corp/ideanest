package az.ideanest.shared.compliance;

import java.util.Objects;

/**
 * An IBAN that passed {@link BankAccountNumbers#check} — issue #399.
 *
 * @param value the electronic form: upper case, no spaces. What is sealed, and never logged
 * @param displayHint country, check digits, an ellipsis and the last four, such as
 *     {@code AZ21…1944}: what a list, a log line or an audit row may carry instead
 */
public record CheckedIban(String value, String displayHint) {

    public CheckedIban {
        Objects.requireNonNull(value, "An IBAN has a number");
        Objects.requireNonNull(displayHint, "An IBAN has a hint");
    }

    /** The hint, never the number: a record logged by accident must not put an IBAN in a log. */
    @Override
    public String toString() {
        return "CheckedIban[" + displayHint + "]";
    }
}
