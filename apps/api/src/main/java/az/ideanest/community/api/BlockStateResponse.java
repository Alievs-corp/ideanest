package az.ideanest.community.api;

/**
 * Whether the caller has blocked this account, after the call they just made — or, from the
 * profile's {@code GET}, right now.
 *
 * <p>The state rather than the outcome, for {@link FollowStateResponse}'s reason: block twice
 * and the answer is the same, because the control is a toggle and the race between two taps is
 * not something the person pressing it can see.
 *
 * @param blocked true from a block, false from an unblock
 */
public record BlockStateResponse(boolean blocked) {
}
