package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.PledgeState;
import java.util.UUID;

/**
 * A backer asked to withdraw a pledge that may not be withdrawn — IDN-EXT-01 (#35), §5.1.
 *
 * <p><strong>A backer cannot cancel a pledge.</strong> Under IDN-EXT-01 a confirmed pledge is a
 * charged one, and a backer may only raise it; every refund is campaign-level (§9.7). What stays
 * is abandoning a checkout: a {@code DRAFT} has charged nothing and holds a place for five
 * minutes, and giving that place back is not a cancellation of anything anybody paid.
 *
 * <p>Its own refusal rather than {@code PLEDGE_NOT_EDITABLE}, because the pledge may still be
 * edited — upward — and a client told "not editable" would hide the controls that still work.
 */
public class PledgeCannotBeCancelledException extends RuntimeException {

    private final UUID pledgeId;
    private final PledgeState state;

    public PledgeCannotBeCancelledException(UUID pledgeId, PledgeState state) {
        super("Pledge " + pledgeId + " is " + state + " and cannot be cancelled by its backer");
        this.pledgeId = pledgeId;
        this.state = state;
    }

    public UUID pledgeId() {
        return pledgeId;
    }

    public PledgeState state() {
        return state;
    }
}
