package az.ideanest.pledge.api;

import az.ideanest.pledge.application.BackerFilter;
import az.ideanest.pledge.domain.PledgeState;
import jakarta.validation.constraints.Size;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * A backer filter in a request body: §4.7's CD-10 axes, as JSON.
 *
 * <p><strong>The same four axes the query string carries</strong>, in the one shape the
 * export and the segment endpoints both take. Having the export accept a query string and
 * the segment a body would be two spellings of one idea, and the first thing that would
 * drift between them is what an omitted field means.
 *
 * <p>Every field is optional and <strong>absent means "any"</strong>, matching
 * {@link BackerFilter}. An empty array means the same thing rather than "match nothing":
 * a client that removed the last chip from a filter row has stopped filtering by it, and
 * a body that meant "no backers at all" would be a screen that mysteriously emptied.
 *
 * <p>The bounds here are the same numbers {@link BackerFilter} enforces, declared as
 * annotations so that an over-long list is a 400 from the framework with a field name in
 * it rather than a message assembled by hand. The value object still checks: a caller that
 * reaches it another way is not exempt from the rule.
 *
 * @param states which pledge states count, from the five the report covers
 * @param rewardTierIds which tiers
 * @param countries ISO 3166-1 alpha-2 destinations, in any case
 * @param term a name or an email address, or part of one
 */
public record BackerFilterBody(
        @Size(max = 2, message = "A filter names at most two states") List<PledgeState> states,
        @Size(max = BackerFilter.MAX_REWARD_TIERS, message = "A filter names at most 200 reward tiers")
                List<UUID> rewardTierIds,
        @Size(max = BackerFilter.MAX_COUNTRIES, message = "A filter names at most 250 destinations")
                List<String> countries,
        @Size(max = BackerFilter.MAX_TERM_LENGTH, message = "A search may not exceed 120 characters") String term) {

    /**
     * The filter this body describes.
     *
     * <p>Built here rather than in the service so that a state outside the report or a
     * destination that is not a country code is a 400 from this module's advice, and not a
     * 500 from the middle of a read.
     */
    public BackerFilter toFilter() {
        return BackerFilter.of(setOf(states), setOf(rewardTierIds), setOf(countries), term);
    }

    /** An absent array and an empty one are the same filter. */
    private static <T> Set<T> setOf(List<T> values) {
        return values == null ? Set.of() : new LinkedHashSet<>(values);
    }
}
