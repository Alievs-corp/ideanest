package az.ideanest.payout.application;

import java.time.Instant;
import java.util.UUID;

/**
 * {@code payout.details_needed} — IDN-EXT-01 (#41): a payout's hold is over and it still waits for the
 * creator's VÖEN and business card. Recorded weekly while it waits.
 */
public record PayoutDetailsNeededEvent(UUID projectId, UUID creatorId, UUID payoutId, Instant payableAt, Instant remindedAt) {

    public static final String AGGREGATE_TYPE = "payout";
    public static final String EVENT_TYPE = "payout.details_needed";
}
