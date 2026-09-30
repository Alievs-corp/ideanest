package az.ideanest.staff.application;

import java.util.UUID;

/** No partner profile for this account — #204. 404, like every well-formed identifier that names nothing. */
public class PartnerNotFoundException extends RuntimeException {

    public PartnerNotFoundException(UUID accountId) {
        super("No partner profile for " + accountId);
    }
}
