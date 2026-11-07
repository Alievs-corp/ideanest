package az.ideanest.media.application;

import java.util.UUID;

/**
 * Whether anything still shows an upload — asked by this module before it deletes one on its own
 * initiative (#647).
 *
 * <p>{@link MediaLibrary#discardAfterCommit} leaves that question to its caller, because this
 * module cannot see what refers to its rows: covers, campaign videos, story blocks, reward tiers
 * and open revisions all live in other modules' tables. That is enough when the caller is the
 * module that holds those references. {@link AvatarUploads} is called from {@code user}, which
 * holds none of them, so the question has to be asked from here; and the modules that can answer
 * it depend on this one, so it is asked through an interface this module owns.
 */
public interface MediaUsage {

    /** Whether a campaign, a story, a reward tier or an open revision still names this upload. */
    boolean isInUse(UUID mediaId);
}
