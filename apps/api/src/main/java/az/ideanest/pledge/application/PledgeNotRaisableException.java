package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.PledgeState;
import java.util.UUID;

/**
 * #171: only a paid pledge is raised by paying the difference.
 *
 * <p>A {@code DRAFT} is still a checkout and is changed with PL-09's edit and paid for once; a legacy
 * {@code CONFIRMED} pledge was never charged and is changed with the edit too; and anything else has
 * ended or is past the point where a backer changes it. The state is carried so the refusal can name
 * the way that does apply.
 */
public class PledgeNotRaisableException extends RuntimeException {

    private final PledgeState state;

    public PledgeNotRaisableException(UUID pledgeId, PledgeState state) {
        super("Pledge " + pledgeId + " is in " + state + " and is not raised by paying the difference");
        this.state = state;
    }

    public PledgeState state() {
        return state;
    }
}
