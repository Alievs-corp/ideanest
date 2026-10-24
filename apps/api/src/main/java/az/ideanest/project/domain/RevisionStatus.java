package az.ideanest.project.domain;

import java.util.Set;

/**
 * Where a revision of a launched campaign is in its short life (V117).
 *
 * <p>{@link #DRAFT} and {@link #PENDING} are the open states: a campaign has at most one
 * revision in either, and the creator keeps working on it. Everything else is a decision
 * already taken and is kept as history.
 */
public enum RevisionStatus {
    /** Being edited. A moderator does not see it. */
    DRAFT,
    /** Submitted, in the moderators' queue. */
    PENDING,
    /** Applied to the campaign. */
    APPROVED,
    /** Refused, with a reason. The campaign is unchanged. */
    REJECTED,
    /** Discarded by the creator. */
    WITHDRAWN;

    public static final Set<RevisionStatus> OPEN = Set.of(DRAFT, PENDING);

    public boolean isOpen() {
        return OPEN.contains(this);
    }
}
