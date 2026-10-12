package az.ideanest.compliance.application;

import az.ideanest.compliance.domain.Iban;
import az.ideanest.compliance.domain.MalformedIbanException;
import az.ideanest.shared.compliance.BankAccountNumbers;
import az.ideanest.shared.compliance.CheckedIban;
import az.ideanest.shared.compliance.UnacceptableIbanException;
import org.springframework.stereotype.Component;

/**
 * {@link BankAccountNumbers}, answered with the compliance module's own {@link Iban} — issue #399.
 *
 * <p>{@link Iban#parse}, not {@link Iban#parseAzerbaijani}: this is for a backer's refund, which goes
 * to whichever account they name. The refusal is translated rather than passed through, so the
 * caller never names this module's domain.
 */
@Component
public class IbanChecks implements BankAccountNumbers {

    @Override
    public CheckedIban check(String typed) {
        try {
            Iban iban = Iban.parse(typed);
            return new CheckedIban(iban.value(), iban.displayHint());
        } catch (MalformedIbanException malformed) {
            throw new UnacceptableIbanException(malformed.defect().name());
        }
    }
}
