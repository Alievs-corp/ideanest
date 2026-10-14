package az.ideanest.pledge.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Everything a checkout has decided by the time a draft is written.
 *
 * <p><strong>A record rather than nine parameters</strong>, for the reason
 * {@link PledgeSelection} gives: three of these are {@code String} and two are
 * {@code UUID}, so a factory taking them positionally would compile with any two of
 * them transposed — and the failure would be a pledge attributed to the wrong
 * referrer, or an idempotency key stored as a country.
 *
 * <p>Distinct from {@link PledgeSelection}, which is what the backer <em>chose</em>
 * and is quoted from. This is what is <em>stored</em>: the quote that came out of
 * that selection, plus the things §7.2 keeps on the row and no arithmetic depends
 * on.
 *
 * @param rewardTierId null for §4.5's PL-02, a pledge with no reward
 * @param quote the five amounts, already computed. The draft carries the whole of
 *     it rather than the tier's price and four zeroes, which is what #51 wrote
 *     before there was a checkout to quote from
 * @param idempotencyKey §10.3's header, recorded on the pledge as well as in
 *     {@code idempotency_keys}. Two records of one fact on purpose: V17's partial
 *     unique index over this column is a second line under the guarantee, so that
 *     even a failure of the machinery in {@code shared} cannot produce two pledges
 *     from one key — and it is how somebody reading a pledge row can tell which
 *     request made it
 * @param reservationExpiresAt when the draft stops holding its place. Never null:
 *     {@code pledges_drafts_are_time_bounded} refuses a draft without one
 */
public record NewPledge(
        UUID projectId,
        UUID backerId,
        UUID rewardTierId,
        PledgeQuote quote,
        String shippingCountry,
        boolean anonymous,
        String referrerCode,
        String idempotencyKey,
        Instant reservationExpiresAt) {

    public NewPledge {
        Objects.requireNonNull(projectId, "A pledge backs a campaign");
        Objects.requireNonNull(backerId, "A pledge is made by somebody");
        Objects.requireNonNull(quote, "A pledge is an amount somebody agreed to");
        Objects.requireNonNull(reservationExpiresAt, "A reservation is time bounded");
    }
}
