package az.ideanest.community.application;

import java.util.List;

/**
 * One page of the accounts somebody blocked, and where the next one starts.
 *
 * <p>The mirror of {@link FollowedCreatorPage}, including its short-page rule: an account
 * closed under §17.4 no longer resolves, so its row is left off the page rather than drawn as
 * somebody with no name. The block itself stays — it is harmless against an account nobody can
 * sign in to.
 *
 * @param items the accounts, most recently blocked first
 * @param next where to continue, or null when this is the last page
 */
public record BlockedAccountPage(List<BlockedAccount> items, SignalCursor next) {

    public BlockedAccountPage {
        items = items == null ? List.of() : List.copyOf(items);
    }
}
