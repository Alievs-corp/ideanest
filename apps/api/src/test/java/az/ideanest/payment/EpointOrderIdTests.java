package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payment.infrastructure.EpointPaymentProvider;
import az.ideanest.payout.domain.Payout;
import az.ideanest.pledge.domain.PledgeRaise;
import az.ideanest.shared.idempotency.IdempotencyKey;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Every key the platform sends Epoint as an {@code order_id} fits Epoint's limit — #178.
 *
 * <p>Epoint documents 255 characters for {@code /request} and {@code /refund-request}
 * ({@link EpointPaymentProvider#MAX_ORDER_ID_LENGTH} has the source). Three kinds of key reach it: a
 * pledge's payment page is opened under the backer's idempotency key, a raise's under the raise's charge
 * key (#171), and a payout is sent under the payout's key. Each is built here by the code that builds it
 * in production, at its longest, and held to the limit. A new kind of key sent as an order id belongs in
 * {@link #everyOrderId()}.
 */
class EpointOrderIdTests {

    /** The last millisecond Java's {@code Instant} can print in four-digit years: the longest epoch-millis. */
    private static final Instant LATEST = Instant.parse("9999-12-31T23:59:59.999Z");

    @Test
    @DisplayName("every order id the platform sends Epoint fits its documented 255 characters")
    void everyOrderIdFits() {
        assertThat(EpointPaymentProvider.MAX_ORDER_ID_LENGTH).isEqualTo(255);
        assertThat(everyOrderId())
                .allSatisfy(orderId -> assertThat(orderId).hasSizeBetween(1, EpointPaymentProvider.MAX_ORDER_ID_LENGTH));
    }

    @Test
    @DisplayName("a raise's charge key is still recognisable as one")
    void aRaiseKeyIsRecognisable() {
        UUID raise = UUID.randomUUID();

        assertThat(PledgeRaise.chargeKeyOf(raise))
                .startsWith(PledgeRaise.CHARGE_KEY_PREFIX)
                .isEqualTo("pledge-raise-" + raise)
                .hasSize(49);
    }

    private static List<String> everyOrderId() {
        UUID id = UUID.randomUUID();
        return List.of(
                // A pledge's payment page: the backer's Idempotency-Key, which is only ever a canonical UUID.
                IdempotencyKey.of(id.toString().toUpperCase()).value(),
                // A raise's payment page (#171).
                PledgeRaise.chargeKeyOf(id),
                // A payout, for each purpose it is priced under: PayoutService and WithdrawalPayouts.
                Payout.idempotencyKeyOf("payout", id, LATEST),
                Payout.idempotencyKeyOf("withdrawal", id, LATEST),
                Payout.idempotencyKeyOf("recalculated", id, LATEST));
    }
}
