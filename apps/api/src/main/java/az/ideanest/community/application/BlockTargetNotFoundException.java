package az.ideanest.community.application;

/**
 * There is no account there to block, or there no longer is one.
 *
 * <p>A 404, and one answer for "never existed" and "closed", for
 * {@link FollowTargetNotFoundException}'s reason: §17.4 makes a closed account unfindable, and
 * an endpoint that told the two apart would confirm that somebody used to be here.
 *
 * <p>The value asked for is deliberately not carried. It is either an account identifier or a
 * slug, and neither is worth echoing: the caller already has it.
 */
public class BlockTargetNotFoundException extends RuntimeException {

    public BlockTargetNotFoundException() {
        super("No account to block there");
    }
}
