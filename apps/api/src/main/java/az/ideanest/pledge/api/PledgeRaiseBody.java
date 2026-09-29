package az.ideanest.pledge.api;

import az.ideanest.pledge.domain.PledgeRaise;
import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

/**
 * #171: one attempt to raise a paid pledge, as the pledge's own response reports it.
 *
 * @param state {@code PENDING}, {@code SUCCEEDED}, {@code FAILED}, {@code EXPIRED}, {@code ABANDONED}
 *     or {@code UNAPPLIED}. Only {@code SUCCEEDED} changed the pledge; {@code UNAPPLIED} was charged
 *     and is being refunded
 * @param amount the difference charged, or to be charged
 * @param total what the pledge comes to once the raise is applied
 * @param holdExpiresAt until when a {@code PENDING} raise holds its places
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record PledgeRaiseBody(
        UUID id, String state, Money amount, Money total, Instant holdExpiresAt, Instant createdAt, Instant endedAt) {

    static PledgeRaiseBody of(PledgeRaise raise) {
        return new PledgeRaiseBody(
                raise.getId(),
                raise.getState().name(),
                Money.of(raise.getAmount(), raise.getCurrency()),
                Money.of(raise.getToTotal(), raise.getCurrency()),
                raise.getHoldExpiresAt(),
                raise.getCreatedAt(),
                raise.getEndedAt());
    }
}
