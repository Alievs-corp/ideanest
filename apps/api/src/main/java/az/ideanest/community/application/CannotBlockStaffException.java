package az.ideanest.community.application;

/**
 * The account being blocked works for the platform.
 *
 * <p>A 422. Staff speak on the platform's behalf — a moderator explaining why a comment was
 * removed, support answering in a thread — and a block that silenced them would let somebody
 * opt out of being moderated. Reporting a member of staff is still open, and is the route for a
 * complaint about one.
 *
 * <p><strong>What it reveals.</strong> Being refused tells the caller that the account is
 * staff, which a public profile does not. That is accepted: the alternative — accepting the
 * block and quietly ignoring it — would tell somebody their block worked when it did not, which
 * is the worse thing to be wrong about on a safety control.
 */
public class CannotBlockStaffException extends RuntimeException {

    public CannotBlockStaffException() {
        super("A member of staff cannot be blocked");
    }
}
