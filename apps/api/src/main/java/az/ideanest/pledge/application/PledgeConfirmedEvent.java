package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code pledge.confirmed}: §6.2's {@code DRAFT --> CONFIRMED}, announced.
 *
 * <p>Recorded by {@link PledgeService#confirm} through §8.3's outbox, inside the
 * transaction that performs the transition, so the event and the state change commit
 * together or neither does. {@code Outbox} carries the whole argument for why that is
 * the only ordering that is not a lie; what is here is the body.
 *
 * <p><strong>This is the pledge module's copy of the contract, and it is deliberately
 * a copy.</strong> {@code analytics} declares the same six fields as the shape it
 * reads, and neither record imports the other. Two modules that share a Java type are
 * one module that cannot be deployed separately, and the direction makes it worse
 * rather than better: the consumer already imports nothing from here and says so in
 * its own comment, so a shared type would have to be imported <em>this</em> way — the
 * producer taking a dependency on a module whose only purpose is to react to it. What
 * they share instead is the JSON, which is exactly what they would share across a
 * broker.
 *
 * <p>The field names below are therefore the contract, and renaming one is a breaking
 * change to every consumer even though nothing on either side would fail to compile.
 * <strong>No existing check catches that.</strong> {@code ModuleBoundaryTests} forbids
 * reaching into another module's {@code domain} or {@code infrastructure} and would
 * not see an import of another module's {@code application} record, and its cycle rule
 * only bites once the dependency runs both ways. So
 * {@code PledgeConfirmedEventTests} asserts the six names literally, which is the only
 * thing that does.
 *
 * <p><strong>A standalone record rather than a member of a {@code PledgeEvents}
 * holder.</strong> {@code AuthEvents} and {@code ProjectEvents} group the messages a
 * module publishes <em>after</em> its commit through Spring's application events —
 * the mechanism §8.3 says loses a message when the process dies in the window. This
 * is the other kind, and putting it beside them would say the two are the same thing.
 *
 * <p><strong>Why a payload with values in it, when {@code Outbox} argues for
 * identifiers.</strong> Its guidance — "enough to route on, and no more" — assumes a
 * consumer that can read the rest inside its own transaction. Attribution cannot: the
 * amount lives in {@code pledges}, which is this module's table, and a consumer
 * reaching for it would be the boundary violation again. So the two facts nobody else
 * can compute travel with the event, and nothing else does. There is no address, no
 * account, no card, and no reward: a module that needs those asks this one.
 *
 * @param pledgeId which pledge. Also the aggregate identifier the event is recorded
 *     under, so that §8.3's per-aggregate ordering is per pledge
 * @param projectId which campaign
 * @param backerId who pledged
 * @param total what the pledge was worth, as §10.3's {@code {"amount", "currency"}}
 *     object with a string amount. <strong>Never a JSON number</strong> — the type
 *     carries its own serialiser, so there is no call site that can produce one
 * @param referrerCode the code the pledge itself carries, when it has one:
 *     {@code pledges.referrer_code}, which §4.5's checkout accepts. Null for the
 *     pledges that arrived without one, which is most of them
 * @param confirmedAt when the transition happened, from the module's injected
 *     {@code Clock} and truncated to what {@code timestamptz} stores. The same
 *     instant that is written to {@code pledges.confirmed_at}, because it is read
 *     back off the row rather than taken again — an event and a column that disagree
 *     about when something happened are two answers to one question
 */
public record PledgeConfirmedEvent(
        UUID pledgeId,
        UUID projectId,
        UUID backerId,
        Money total,
        String referrerCode,
        Instant confirmedAt) {

    /**
     * Which kind of thing this happened to, and half of §8.3's ordering key.
     *
     * <p>{@code Outbox.record}'s own javadoc names {@code pledge} as the example. It
     * is a constant here so that a second event about a pledge cannot be recorded
     * under a different word and quietly get its own ordering.
     */
    public static final String AGGREGATE_TYPE = "pledge";

    /** What happened, in the vocabulary consumers switch on. */
    public static final String EVENT_TYPE = "pledge.confirmed";

    /**
     * The event for a pledge that has just been confirmed.
     *
     * <p>Everything is read off the row, including the instant — see
     * {@code confirmedAt} above. The total is the database's generated
     * {@code total_amount} paired with the row's currency, which is the same number
     * the backer was shown and the same one a card will be charged.
     *
     * @throws IllegalStateException when the pledge has not been confirmed, which
     *     would produce an event with no {@code confirmedAt} announcing a transition
     *     that did not happen
     */
    public static PledgeConfirmedEvent of(Pledge pledge) {
        // COLLECTED too since IDN-EXT-01 (#39): a paid-for pledge is confirmed by being paid for.
        if (!(pledge.isConfirmed() || pledge.getState() == PledgeState.COLLECTED) || pledge.getConfirmedAt() == null) {
            throw new IllegalStateException("A pledge in " + pledge.getState() + " has not been confirmed");
        }
        return new PledgeConfirmedEvent(
                pledge.getId(),
                pledge.getProjectId(),
                pledge.getBackerId(),
                Money.of(pledge.getTotalAmount(), pledge.getCurrency()),
                pledge.getReferrerCode(),
                pledge.getConfirmedAt());
    }
}
