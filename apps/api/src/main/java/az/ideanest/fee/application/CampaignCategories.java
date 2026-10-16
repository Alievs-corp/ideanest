package az.ideanest.fee.application;

import java.util.Optional;
import java.util.UUID;

/**
 * What a campaign is filed under, asked of the module that knows — issue #311.
 *
 * <p><strong>{@code ProjectSummaries}' shape, for the same reason.</strong> A category
 * exception is one of the three scopes {@code FeeScope} names, so pricing a payout has to
 * know which category the campaign is in — and {@code projects} is the project module's
 * table, which {@code ModuleBoundaryTests} keeps this module out of.
 *
 * <p>The alternative was to make every caller of {@link FeeSchedules#priceOf} pass the
 * category. That is worse in a way that is easy to miss: the payout module does not know a
 * campaign's category either, so it would have to be threaded through from wherever
 * somebody did — and the first caller to pass null would silently switch off every
 * category exception on the platform, with no symptom but a slightly larger payout.
 *
 * <p>So the question is asked here, once, by the module that needs the answer.
 */
public interface CampaignCategories {

    /**
     * The campaign's category, or empty when there is no such campaign.
     *
     * <p>Empty rather than a refusal, because pricing must not fail for a reason the
     * operator could not have prevented — {@link FeeSchedules} makes the same trade when
     * no schedule is configured, and has the argument. A campaign with no category prices
     * against the platform default, which is what an uncategorised campaign should pay.
     */
    Optional<UUID> categoryOf(UUID projectId);

    /**
     * Whether a category with this identifier exists, in any state. Asked before a category exception
     * is opened, so a mistyped identifier is refused rather than priced.
     */
    boolean categoryExists(UUID categoryId);

    /** Whether a campaign with this identifier exists, in any state. {@link #categoryExists}'s reason. */
    boolean campaignExists(UUID projectId);
}
