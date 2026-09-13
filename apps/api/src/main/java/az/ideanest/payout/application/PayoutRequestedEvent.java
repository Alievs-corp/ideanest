package az.ideanest.payout.application;

import java.time.Instant;
import java.util.UUID;

/**
 * {@code payout.requested} — IDN-EXT-01 (#41): a withdrawal's payout is requested and its hold runs.
 *
 * <p>Every backer of the campaign is told from this that they may dispute their payment until at
 * least {@code payableAt} — and until the money is actually sent, if that is later (§6.3).
 */
public record PayoutRequestedEvent(
        UUID projectId, UUID creatorId, UUID payoutId, Instant payableAt, boolean automatic, Instant requestedAt) {

    public static final String AGGREGATE_TYPE = "payout";
    public static final String EVENT_TYPE = "payout.requested";
}
