package az.ideanest.ticket.application;

/**
 * A ticket was to be raised without saying whose conversation it is — #416.
 *
 * <p>400. Only a ticket about a pledge may leave the requester out, because only there does the
 * subject name a person: the pledge's backer.
 */
public class RequesterRequiredException extends RuntimeException {

    public RequesterRequiredException() {
        super("A ticket names its requester unless it is about a pledge");
    }
}
