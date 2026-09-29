package az.ideanest.payment.domain;

/**
 * Why money was sent back — §9.7 and §4.11's AD-06, issues #67 and #307.
 *
 * <p><strong>{@code RefundRequest.reasonCode} is a {@code String} and this is the
 * vocabulary behind it.</strong> That type's comment says so: "#67 owns the vocabulary of
 * §9.7's five scenarios, and inventing it here — in the issue that is only supposed to
 * settle the interface — would mean #67 either inherits a list nobody designed or changes
 * a type four other calls depend on". This is #67 keeping that promise.
 *
 * <p><strong>A closed set because refunds are counted.</strong> §4.11 asks for "reason
 * codes" rather than "reasons", and the difference is that "how many refunds were because
 * a campaign was halted" has a number for an answer. Free text makes it a question with a
 * spreadsheet for an answer, which is what {@code refunds.detail} is for — the code is
 * the countable half and the detail is the story.
 *
 * <p>The values match V53's {@code CHECK} exactly, and both exist for {@code
 * ReportTargetType}'s reason: the enum stops the writing side inventing a spelling, and
 * the constraint holds against a support script.
 */
public enum RefundReason {

    /** The backer asked, and the campaign had not shipped. */
    BACKER_REQUEST,

    /**
     * §6.1's suspension, or a creator cancelling.
     *
     * <p>The pledge module already ends every pledge on a halted campaign — the listener
     * §4.11 describes — and this is the money following it. The two are separate because
     * ending a pledge is instant and returning money is a provider call that can fail.
     */
    CAMPAIGN_HALTED,

    /** The campaign missed its goal and something had been collected anyway. */
    CAMPAIGN_FAILED,

    /** The creator did not deliver what was promised. */
    FULFILMENT_FAILURE,

    /** Charged twice for one thing. */
    DUPLICATE_CHARGE,

    /**
     * The platform's own mistake, whatever it was.
     *
     * <p>Deliberately present. A taxonomy with no "our fault" bucket gets one anyway,
     * spelled as whichever of the others is closest — and the number that then goes wrong
     * is the one somebody is using to decide whether creators are failing to deliver.
     */
    PLATFORM_ERROR,

    /**
     * Answering a chargeback by conceding it before the network decides — #68.
     *
     * <p>Its own code because it is the one refund the platform did not choose to make on
     * its merits. Counting it with {@link #BACKER_REQUEST} would overstate how often
     * backers ask and understate how often the platform loses a dispute.
     */
    DISPUTE_CONCEDED,

    /** The charge was not the cardholder's. */
    FRAUD,

    /**
     * #171: the backer paid to raise their pledge and the raise could not be applied.
     *
     * <p>The provider took the difference, and by the time it said so the pledge had moved on — it was
     * refunded with its campaign, or a later raise changed it, or the places the raise needed were
     * gone. The money bought nothing, so the platform returns it on its own, the way it returns a
     * failed campaign's pledges: no member of staff decides it, and V83 allows it without an author.
     */
    RAISE_NOT_APPLIED,

    /**
     * #175: the card network took the money back — a chargeback lost or conceded.
     *
     * <p>Never sent to a provider and never issued by a person: {@code DisputeService} records it,
     * already {@code SUCCEEDED}, when the case is resolved against the platform. It is a refund row
     * at all so that every read that asks what of a charge has gone back — the overdraft check, the
     * per-charge remainder, the campaign-refunds sweep, the payout's refunded figure — counts it
     * without knowing chargebacks exist. Without it the same money was refundable a second time.
     * Its own code, not {@link #DISPUTE_CONCEDED}: that one is a refund the platform chose to send.
     */
    CHARGEBACK
}
