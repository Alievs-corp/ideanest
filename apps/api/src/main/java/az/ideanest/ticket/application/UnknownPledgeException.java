package az.ideanest.ticket.application;

import java.util.UUID;

/**
 * A ticket's requester was left to a pledge that does not exist — #416.
 *
 * <p>404. Nothing to be evasive about: the caller holds {@code HANDLE_SUPPORT}.
 */
public class UnknownPledgeException extends RuntimeException {

    public UnknownPledgeException(UUID pledgeId) {
        super("No pledge " + pledgeId);
    }
}
