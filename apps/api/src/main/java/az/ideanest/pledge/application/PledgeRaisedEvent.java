package az.ideanest.pledge.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * #171: a paid pledge was raised — recorded in the outbox as {@code pledge.edited}.
 *
 * <p>The event §4.10 already gives a backer who changed their pledge, with the fields its consumer
 * reads ({@code NotificationEvents.PledgeEdited}): the backer is told what the pledge comes to now.
 * {@code raisedBy} is the difference that was charged, which the notification does not need and an
 * analytics consumer may.
 */
public record PledgeRaisedEvent(
        UUID pledgeId, UUID projectId, UUID backerId, Money total, Money raisedBy, Instant editedAt) {

    public static final String AGGREGATE_TYPE = "pledge";

    public static final String EVENT_TYPE = "pledge.edited";
}
