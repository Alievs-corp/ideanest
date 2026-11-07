package az.ideanest.analytics.domain;

/**
 * Where a campaign card was clicked — #633. Only a {@code CLICK} carries one.
 *
 * <p>Stored by name in {@code audience_hourly.surface}, where every row that is not a
 * click holds {@code NONE} instead: V124's unique key has no NULL in it. {@code NONE}
 * is the table's and never appears on the wire.
 */
public enum AudienceSurface {
    HOME,
    DISCOVER,
    SEARCH,
    CATEGORY,
    COLLECTION,
    PROFILE,
    SAVED,
    OTHER
}
