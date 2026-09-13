package az.ideanest.discovery.domain;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The words a backer uses for where a campaign is, and the internal states
 * each of them covers.
 *
 * <p>§4.3 offers five status filters. §6.1 has sixteen states. They are not the
 * same vocabulary and must not be conflated: a backer asking for "successful"
 * means "it made its goal", which is true of a campaign that is still collecting,
 * one that is shipping, and one that finished two years ago. Mapping the two is
 * therefore a product decision, and this enum is the one place it is written down.
 *
 * <p><strong>States are strings here, not {@code ProjectState}.</strong> Discovery
 * may not import {@code project.domain} — {@code ModuleBoundaryTests} fails the
 * build for it — and this module reads {@code projects.state} as text out of its
 * own SQL anyway. {@code DiscoveryStatusTests} imports both and fails if a name
 * here is not a state there, or if the sixteen are not partitioned exactly once
 * into {@link #PUBLIC_STATES} and {@link #HIDDEN_STATES}.
 */
public enum DiscoveryStatus {

    /**
     * "It has not opened yet, but I can follow it."
     *
     * <p>Only {@code PRELAUNCH}. {@code APPROVED} and {@code SCHEDULED} are also
     * campaigns that have not opened, and both are deliberately excluded: neither
     * has a public page, and listing one would announce a launch date the creator
     * has not announced. A campaign becomes discoverable as upcoming by taking the
     * {@code DRAFT → PRELAUNCH} edge, which is an act, not a side effect of
     * moderation clearing it.
     */
    UPCOMING("upcoming", "PRELAUNCH"),

    /**
     * "I can back it right now, and the clock is running."
     *
     * <p>{@code LIVE}, and since IDN-EXT-01 the seven days after its first deadline and its
     * extension: all three are still taking pledges, and the campaign is not decided until
     * the last of them ends.
     */
    LIVE("live", "LIVE", "CLOSING_WINDOW", "EXTENDED"),

    /**
     * "It was extended, and it is still taking pledges" — IDN-EXT-01 (#37).
     *
     * <p>Only {@code EXTENDED}. Deliberately also inside {@link #LIVE}: an extended campaign
     * is still funding, and a backer filtering for live campaigns would be surprised to find
     * it missing. Its card badges as {@code live} and says it was extended separately, because
     * a campaign can be extended and closing soon at once — see {@code ProjectCard}.
     */
    EXTENDED("extended", "EXTENDED"),

    /**
     * "It made it."
     *
     * <p>Five states, because reaching the goal is one event and everything after
     * it is fulfilment. {@code SUCCESSFUL} is the deadline having passed at or
     * above goal; {@code COLLECTING} is the cards being charged; {@code LATE_PLEDGE}
     * is that window still being open; {@code FULFILLING} is rewards going out; and
     * {@code COMPLETED} is all of them delivered. A backer browsing "successful"
     * wants to see what this platform has actually funded, and excluding the four
     * that came after would show them the newest tenth of it.
     */
    SUCCESSFUL("successful", "SUCCESSFUL", "COLLECTING", "LATE_PLEDGE", "WITHDRAWN", "FULFILLING", "COMPLETED");

    /**
     * The nine states a campaign may be listed in, whatever was asked for.
     *
     * <p>Applied to every query before any caller filter is. The seven that are
     * absent are absent for three different reasons and all of them matter:
     *
     * <ul>
     *   <li>{@code DRAFT}, {@code SUBMITTED}, {@code CHANGES_REQUESTED} and
     *       {@code APPROVED} are work in progress. Listing one publishes what
     *       somebody is preparing, and in the case of {@code SUBMITTED} it would
     *       also publish the length of the moderation queue.
     *   <li>{@code SCHEDULED} is cleared and dated but not announced. The
     *       creator decides when a launch date becomes public.
     *   <li>{@code REJECTED} and {@code SUSPENDED} are moderation outcomes. A
     *       suspended campaign is one trust and safety stopped, frequently while
     *       an investigation is open, and its appearance in a feed is the single
     *       worst failure this endpoint can have.
     * </ul>
     *
     * <p>{@code CANCELED} <em>is</em> here. It launched, the public saw it, people
     * may have pledged to it, and its page still resolves; hiding it from discovery
     * while it remains readable by URL would be a different answer to the same
     * question depending on how it was asked. It belongs to no status grouping,
     * which is deliberate: it can be reached by browsing and cannot be singled out by a
     * filter, because §4.3 offers no word for it.
     *
     * <p>{@code UNSUCCESSFUL} is here too, and is <em>not</em> listed — see
     * {@link #LISTED_STATES}. This set is "the page is public", which the reward list and
     * {@code PublicProjects} answer for as well.
     */
    public static final Set<String> PUBLIC_STATES = Set.of(
            "PRELAUNCH", "LIVE", "CANCELED", "SUCCESSFUL", "UNSUCCESSFUL",
            "COLLECTING", "LATE_PLEDGE", "FULFILLING", "COMPLETED",
            // IDN-EXT-01 (#32): still taking pledges, and closed by withdrawal.
            "CLOSING_WINDOW", "EXTENDED", "WITHDRAWN");

    /**
     * The states the catalogue and search list a campaign in — IDN-EXT-01 (#37).
     *
     * <p>{@link #PUBLIC_STATES} without {@code UNSUCCESSFUL}. A campaign that ended without
     * succeeding is hidden from browsing and from search <em>only</em>: its page, its rewards
     * and its updates still resolve by link and from a backer's account, which is why
     * {@code PUBLIC_STATES} keeps it. Every read in this module that returns, suggests or
     * counts campaigns applies this set, before any caller filter.
     */
    public static final Set<String> LISTED_STATES = PUBLIC_STATES.stream()
            .filter(state -> !"UNSUCCESSFUL".equals(state))
            .collect(Collectors.toUnmodifiableSet());

    /**
     * The seven that must never be returned by anything in this module.
     *
     * <p>Stated as its own set rather than derived, so that the test which checks
     * the partition is checking two independent statements against §6.1 rather than
     * one statement against itself.
     */
    public static final Set<String> HIDDEN_STATES = Set.of(
            "DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED", "APPROVED", "SCHEDULED", "SUSPENDED");

    /**
     * Which grouping a card's badge shows, for a state that is in more than one.
     *
     * <p>{@link #EXTENDED} is not a badge: an extended campaign badges as {@code live}, and
     * the card carries {@code extended} beside it. A campaign left in {@code LATE_PLEDGE}
     * badges as successful, which is what it is.
     */
    private static final List<DiscoveryStatus> BADGE_ORDER = List.of(UPCOMING, LIVE, SUCCESSFUL);

    private static final Map<String, DiscoveryStatus> BY_WIRE_VALUE = byWireValue();

    private final String wireValue;
    private final Set<String> states;

    DiscoveryStatus(String wireValue, String... states) {
        this.wireValue = wireValue;
        this.states = Set.of(states);
    }

    /** What a client sends and reads back, as §4.3 spells it. */
    public String wireValue() {
        return wireValue;
    }

    /** The internal states this grouping covers. Always a subset of {@link #LISTED_STATES}. */
    public Set<String> states() {
        return states;
    }

    /** The grouping a client named, or empty when the word is not one of the five. */
    public static Optional<DiscoveryStatus> fromWireValue(String value) {
        return Optional.ofNullable(value).map(BY_WIRE_VALUE::get);
    }

    /** Every wire value, in declaration order, for a facet list and for an error message. */
    public static List<String> wireValues() {
        return List.copyOf(BY_WIRE_VALUE.keySet());
    }

    /**
     * The badge for one campaign, or empty when no grouping claims its state.
     *
     * <p>Empty means {@code CANCELED} today. A card with no badge renders without
     * one rather than with a wrong one.
     */
    public static Optional<DiscoveryStatus> badgeFor(String state) {
        for (DiscoveryStatus candidate : BADGE_ORDER) {
            if (candidate.states.contains(state)) {
                return Optional.of(candidate);
            }
        }
        return Optional.empty();
    }

    /**
     * The states a set of groupings covers, intersected with what the public may see.
     *
     * <p>The intersection is not defensive decoration. It is the one line that makes
     * "a filter can narrow the public set and can never widen it" true no matter what
     * a future grouping is defined to contain.
     *
     * @param statuses empty for "no status filter", which is every listed state
     */
    public static Set<String> statesFor(Set<DiscoveryStatus> statuses) {
        if (statuses == null || statuses.isEmpty()) {
            return LISTED_STATES;
        }
        Set<String> states = new LinkedHashSet<>();
        for (DiscoveryStatus status : statuses) {
            states.addAll(status.states);
        }
        states.retainAll(LISTED_STATES);
        return Collections.unmodifiableSet(states);
    }

    private static Map<String, DiscoveryStatus> byWireValue() {
        Map<String, DiscoveryStatus> map = new LinkedHashMap<>();
        for (DiscoveryStatus status : values()) {
            map.put(status.wireValue, status);
        }
        return Collections.unmodifiableMap(map);
    }
}
