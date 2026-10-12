package az.ideanest.compliance.application;

import java.util.UUID;

/**
 * A member of staff asked to see a creator's IBAN, and what is on file is not one — #394.
 *
 * <p>Nothing filed, or a provider's token. Thrown by the controller rather than the service,
 * because {@code PayoutDestinations.revealBankAccount} answers the payout module with an empty
 * {@code Optional}, and only a screen needs the absence to be a refusal.
 */
public class NoBankAccountOnFileException extends RuntimeException {

    private final UUID creatorId;

    public NoBankAccountOnFileException(UUID creatorId) {
        super("Creator " + creatorId + " has no bank account on file");
        this.creatorId = creatorId;
    }

    public UUID creatorId() {
        return creatorId;
    }
}
