package az.ideanest.reward.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * §4.8's PM-13: a name a creator gives to a group of destinations, so that
 * "ship to the European Union for 12" is one rate rather than twenty-seven.
 *
 * <p><strong>Per campaign rather than platform-wide.</strong> A list the platform
 * maintained would be the platform deciding whether "Europe" includes Turkey on
 * behalf of a creator whose carrier has already decided otherwise, with no way for
 * them to say so. A zone is a property of the tariff somebody negotiated, so it
 * belongs to whoever negotiated it.
 *
 * <p><strong>The countries are held here and not as an entity of their own.</strong>
 * {@code shipping_zone_countries} has no identity beyond the pair it holds, nothing
 * ever loads one, and every read of a zone wants all of them — the same argument
 * {@code survey_questions.choices} makes about options. What the table does give,
 * and a collection column could not, is the primary key on
 * {@code (project_id, country_code)}: a destination falls into at most one zone per
 * campaign, which is what keeps rate resolution a two-way question rather than an
 * n-way one with a priority column in it.
 */
@Entity
@Table(name = "shipping_zones")
public class ShippingZone {

    /** ISO 3166-1 alpha-2, uppercase, as everywhere a destination is named. */
    private static final int COUNTRY_CODE_LENGTH = 2;

    private static final int MAX_NAME_LENGTH = 60;

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "created_at", nullable = false, updatable = false, insertable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ShippingZone() {
        // JPA.
    }

    /**
     * @throws IllegalArgumentException when the name is blank or too long. Both are
     *     refused rather than trimmed to fit: a zone is chosen from a list in the
     *     rate editor, and a name silently shortened is one the creator cannot find
     *     again
     */
    public static ShippingZone named(UUID id, UUID projectId, String name) {
        ShippingZone zone = new ShippingZone();
        zone.id = Objects.requireNonNull(id, "A zone has an identifier");
        zone.projectId = Objects.requireNonNull(projectId, "A zone belongs to a campaign");
        zone.name = validName(name);
        return zone;
    }

    /** The name a zone would be stored with, or a refusal saying why it cannot be. */
    public static String validName(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException(
                    "A shipping zone's name is between 1 and " + MAX_NAME_LENGTH + " characters");
        }
        return trimmed;
    }

    /**
     * Normalises a destination the way every table that stores one does.
     *
     * <p>A creator typing "de" means Germany, and a zone holding both "de" and "DE"
     * is a zone that covers one country twice — which the primary key would then
     * refuse with a message about a constraint rather than about a duplicate.
     *
     * @throws IllegalArgumentException when it is not two letters
     */
    public static String normaliseCountry(String countryCode) {
        String normalised = countryCode == null ? "" : countryCode.trim().toUpperCase(Locale.ROOT);
        if (normalised.length() != COUNTRY_CODE_LENGTH || !normalised.chars().allMatch(Character::isLetter)) {
            throw new IllegalArgumentException("A destination is a two-letter ISO 3166-1 country code");
        }
        return normalised;
    }

    /** Normalised, de-duplicated, and in the order the creator gave them. */
    public static Set<String> normaliseCountries(Iterable<String> countryCodes) {
        Set<String> normalised = new LinkedHashSet<>();
        for (String code : countryCodes) {
            normalised.add(normaliseCountry(code));
        }
        if (normalised.isEmpty()) {
            // A zone covering nothing prices nothing, so it is not a
            // configuration of the feature. Saying so here means the creator
            // reads a sentence rather than watching a rate silently never apply.
            throw new IllegalArgumentException("A shipping zone covers at least one destination");
        }
        return normalised;
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public String getName() {
        return name;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    /** The same zone under a new name. Its rates and its membership are untouched. */
    public void rename(String name) {
        this.name = validName(name);
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        return other instanceof ShippingZone zone && Objects.equals(id, zone.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        return "ShippingZone[" + id + ", " + name + "]";
    }
}
