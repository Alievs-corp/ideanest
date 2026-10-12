package az.ideanest.compliance.domain;

import java.util.Objects;

/**
 * An account number that is not an IBAN the platform will pay into — issue #394.
 *
 * <p><strong>Does not carry what was typed</strong>, unlike {@link MalformedTaxIdentifierException}.
 * A VÖEN names a company; an IBAN, even a mistyped one, is most of somebody's account number,
 * and an exception message is the thing that ends up in a log line. {@link #defect()} says what
 * is wrong with it instead, which is what the creator needs in order to fix it.
 */
public class MalformedIbanException extends RuntimeException {

    private final Iban.Defect defect;

    public MalformedIbanException(Iban.Defect defect) {
        super("Not an acceptable IBAN: " + Objects.requireNonNull(defect, "defect"));
        this.defect = defect;
    }

    /** What is wrong, from a closed set the client can translate. */
    public Iban.Defect defect() {
        return defect;
    }
}
