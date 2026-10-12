package az.ideanest.shared.compliance;

import java.util.Objects;

/**
 * A typed account number that is not an IBAN — issue #399.
 *
 * <p>{@code compliance.domain.MalformedIbanException} as the other modules may see it. Like that one
 * it does not carry what was typed: even a mistyped IBAN is most of somebody's account number, and an
 * exception message is the thing that ends up in a log line.
 */
public class UnacceptableIbanException extends RuntimeException {

    private final String defect;

    /** @param defect the name of an {@code Iban.Defect}, which a client translates */
    public UnacceptableIbanException(String defect) {
        super("Not an IBAN: " + Objects.requireNonNull(defect, "defect"));
        this.defect = defect;
    }

    public String defect() {
        return defect;
    }
}
