package az.ideanest.payment.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * What a collected pledge announces through §8.3's outbox (#64, #39).
 *
 * <p>Recorded in the same transaction as the state change it describes, so that a pledge
 * cannot be collected without its backer being told and a backer cannot be told about a
 * payment that rolled back. {@code HostedChargeEvents} is the producer since IDN-EXT-01.
 *
 * <p>Until #45 this also declared {@code pledge.payment_failed} and
 * {@code pledge.payment_final_warning}, the retries of the stored-card collection at close.
 * That collection is gone, so nothing produces them; {@code NotificationEvents} still reads
 * both, because notifications already sent under those types stay readable.
 *
 * <p><strong>The aggregate is the pledge</strong>, which gives §8.3's ordering
 * guarantee exactly where it is needed: the relay will not publish an event for a pledge
 * while an earlier pending one for the same pledge exists.
 *
 * <p>These are copies of a contract in the same sense {@code CampaignFinalisedEvent} is:
 * {@code NotificationEvents} declares its own reading of the same JSON, neither imports
 * the other, and the field names here are therefore the contract. Renaming one breaks
 * every consumer without breaking any compilation.
 */
public final class CollectionEvents {

    /**
     * Which kind of thing these happened to, and half of §8.3's ordering key.
     *
     * <p>The same word {@code pledge.confirmed} and {@code pledge.edited} are recorded
     * under, deliberately: a second aggregate name for the same rows would give a pledge
     * two independent orderings.
     */
    public static final String AGGREGATE_TYPE = "pledge";

    private CollectionEvents() {}

    /**
     * §6.2's {@code DRAFT → COLLECTED}: the backer paid on the provider's page.
     *
     * <p>Recipient: the backer. §4.10's {@code PAYMENT_COLLECTED} row — the receipt for
     * money that has actually left their account.
     *
     * @param amount what was taken, as §10.3's {@code {"amount", "currency"}} object with
     *     a string amount. <strong>Never a JSON number</strong>: a receipt that rounds
     *     somebody's charge is worse than no receipt
     * @param collectedAt when the charge was approved. On the event rather than read from
     *     the clock at delivery, because an event delivered an hour late describes
     *     something an hour old
     */
    public record PledgeCollected(
            UUID pledgeId, UUID projectId, UUID backerId, Money amount, Instant collectedAt) {

        public static final String EVENT_TYPE = "pledge.collected";
    }
}
