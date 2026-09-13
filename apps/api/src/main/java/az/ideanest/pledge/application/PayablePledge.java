package az.ideanest.pledge.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * A draft that may be paid for now, and what paying for it costs — IDN-EXT-01 (#39).
 *
 * <p>What the pledge module tells {@link PaymentPage}: identifiers and an amount, never the entity.
 *
 * @param heldUntil when the draft's places are released if no payment arrives
 */
public record PayablePledge(UUID pledgeId, UUID projectId, UUID backerId, Money total, Instant heldUntil) {
}
