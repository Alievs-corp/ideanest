package az.ideanest.community.application;

/**
 * The account being blocked is the account doing the blocking.
 *
 * <p>A 422, for {@link CannotFollowYourselfException}'s reason: {@code user_blocks_is_not_self}
 * would refuse the row regardless, and this makes the refusal a sentence rather than a
 * constraint violation with a 500 in front of it. There is nothing a self-block could mean — the
 * comments it would hide are the blocker's own.
 */
public class CannotBlockYourselfException extends RuntimeException {

    public CannotBlockYourselfException() {
        super("An account cannot block itself");
    }
}
