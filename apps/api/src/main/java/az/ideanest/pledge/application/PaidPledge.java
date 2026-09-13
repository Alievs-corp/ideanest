package az.ideanest.pledge.application;

import az.ideanest.shared.money.Money;
import java.util.UUID;

/** A pledge the provider said was paid for, now {@code COLLECTED} — IDN-EXT-01 (#39). */
public record PaidPledge(UUID pledgeId, UUID projectId, UUID backerId, Money total) {
}
