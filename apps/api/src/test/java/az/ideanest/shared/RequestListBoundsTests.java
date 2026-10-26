package az.ideanest.shared;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.community.api.ReorderFaqsRequest;
import az.ideanest.project.api.ProjectPatchRequest;
import az.ideanest.reward.api.ShippingZoneBody;
import az.ideanest.reward.api.ShippingZonesRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Every list a request carries has a bound (#587), checked with the validator the service builds
 * and without starting it.
 *
 * <p>The interesting case is {@link Patched}: a partial update's list is inside the wrapper, and
 * the bound reaches it only through {@link PatchedValueExtractor}, which Hibernate Validator finds
 * through {@code META-INF/services}. Without the registration the annotation is refused outright,
 * so {@link #aPatchedListIsBounded()} is also the test that the file is there.
 */
class RequestListBoundsTests {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void build() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void close() {
        factory.close();
    }

    @Test
    @DisplayName("a reorder of a campaign's FAQ names at most two hundred entries")
    void aReorderIsBounded() {
        assertThat(validator.validate(new ReorderFaqsRequest(ids(200)))).isEmpty();
        assertThat(paths(validator.validate(new ReorderFaqsRequest(ids(201))))).containsExactly("faqIds");
    }

    @Test
    @DisplayName("a list inside a partial update is bounded, and an absent or cleared one is not refused")
    void aPatchedListIsBounded() {
        assertThat(validator.validate(withCountries(Patched.of(Collections.nCopies(300, "AZ"))))).isEmpty();
        List<String> tooMany = paths(validator.validate(withCountries(Patched.of(Collections.nCopies(301, "AZ")))));
        assertThat(tooMany).hasSize(1);
        assertThat(tooMany.getFirst()).startsWith("countries");
        assertThat(validator.validate(withCountries(Patched.absent()))).isEmpty();
        assertThat(validator.validate(withCountries(Patched.of(null)))).isEmpty();
    }

    @Test
    @DisplayName("a bound on a nested list is reached through the list that holds it")
    void aNestedListIsBounded() {
        ShippingZonesRequest request = new ShippingZonesRequest(
                List.of(new ShippingZoneBody(null, "Everywhere", Collections.nCopies(301, "AZ"))));

        List<String> refused = paths(validator.validate(request));
        assertThat(refused).hasSize(1);
        assertThat(refused.getFirst()).contains("countryCodes");
    }

    private static ProjectPatchRequest withCountries(Patched<List<String>> countries) {
        return new ProjectPatchRequest(null, null, null, null, null, null, null, null, null, null, null, countries);
    }

    private static List<UUID> ids(int count) {
        return Stream.generate(UUID::randomUUID).limit(count).toList();
    }

    private static List<String> paths(Set<? extends ConstraintViolation<?>> violations) {
        return violations.stream().map(violation -> violation.getPropertyPath().toString()).toList();
    }
}
