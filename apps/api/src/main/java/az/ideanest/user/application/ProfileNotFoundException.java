package az.ideanest.user.application;

/**
 * No profile at that address — §4.2's P-07, and §17.4.
 *
 * <p><strong>Three different facts, one exception, on purpose.</strong> A slug nobody
 * holds, a slug that belonged to an account §17.4 has anonymised, and a slug whose owner
 * set {@link az.ideanest.user.domain.ProfileVisibility#PRIVATE} all reach here and all
 * come back as the same 404 with the same body. Since #647 a slug whose owner has asked for
 * the account to be deleted, and is inside the grace period, answers exactly as a private
 * one does, for the reason the first pair below gives.
 *
 * <p>Telling them apart is the whole failure this type exists to prevent, and each pair
 * fails differently:
 *
 * <ul>
 *   <li><strong>Private against absent.</strong> A 403 for a private profile is an oracle
 *       any stranger can ask: it confirms that the person behind a guessed slug has an
 *       account here and has chosen to hide it, which is exactly the fact the setting was
 *       chosen to withhold. P-07 promises a withdrawn page, not a page with a locked door
 *       and a nameplate on it.
 *   <li><strong>Deleted against absent.</strong> §17.4 exists to make it untrue that this
 *       platform holds a record of a particular person. An endpoint that answered "gone"
 *       rather than "never here" would restore that record to anybody who could guess the
 *       slug — and a slug is somebody's name. {@code FollowTargetNotFoundException} makes
 *       the same argument for the same reason at {@code POST /v1/users/{slug}/follow},
 *       and the two must not disagree, or the difference between their answers is the
 *       oracle neither of them is.
 * </ul>
 *
 * <p><strong>A suspended account is not one of the three</strong>, and that is a decision
 * rather than an omission. §4.11's AD-04 stops an account from signing in; it does not
 * retract what the account already published, and a campaign it launched stays on
 * {@code /projects/{creatorSlug}/{projectSlug}} with the creator's name in the header
 * because {@code PublicProjects} decides that page by the campaign's state and not by its
 * creator's. Withdrawing the profile while leaving those pages up would hide the index and
 * publish everything it indexes, which is a half-measure that looks like a control. If the
 * profile should go too, so should the campaigns, and that is a product decision about
 * AD-04 rather than something to settle inside a read.
 */
public class ProfileNotFoundException extends RuntimeException {

    public ProfileNotFoundException(String slug) {
        // The slug and nothing else. It is already in the request line, so naming it here
        // reveals nothing the caller did not send, and what is still withheld is which of
        // the three facts above applied -- including from whoever reads the log.
        super("No public profile at " + slug);
    }
}
