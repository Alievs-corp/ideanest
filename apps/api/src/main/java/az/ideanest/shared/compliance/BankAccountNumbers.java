package az.ideanest.shared.compliance;

/**
 * Whether a typed string is an IBAN, asked across a module boundary — issue #399.
 *
 * <p>A refund past the provider's window goes back to whichever bank account the backer names, and
 * the payment module, which records it, may not name {@code compliance.domain.Iban}: that class is
 * where a creator's account is checked, and {@code ModuleBoundaryTests} keeps it inside the module
 * that owns it. Copying the mod-97 check into the payment module would be a second definition of an
 * IBAN that could disagree with the first. So the payment module names this, and
 * {@code compliance.application.IbanChecks} answers it with the same {@code Iban.parse} a creator's
 * account goes through.
 *
 * <p>Any country's IBAN, unlike a creator's: a backer banks wherever they bank.
 */
public interface BankAccountNumbers {

    /**
     * The IBAN, normalised — spaces removed, upper case — and checked: characters, the country's
     * registered length and structure, and the mod-97 check digits.
     *
     * @throws UnacceptableIbanException with what is wrong, from {@code Iban.Defect}'s closed set
     */
    CheckedIban check(String typed);
}
