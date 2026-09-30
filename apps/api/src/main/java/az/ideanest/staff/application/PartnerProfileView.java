package az.ideanest.staff.application;

import az.ideanest.staff.domain.PartnerSection;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * One partner as the super admin sees them — #204.
 *
 * @param accountId the partner's account
 * @param percentage the share of the financial statistics this partner sees, in (0, 100],
 *     at most two decimal places. A {@link BigDecimal} and never a double: it multiplies money
 * @param sections the console sections opened to them beyond their statistics
 * @param createdBy the super admin who made them a partner
 * @param updatedBy whoever last changed the percentage or the sections
 */
public record PartnerProfileView(
        UUID accountId,
        BigDecimal percentage,
        Set<PartnerSection> sections,
        Instant createdAt,
        UUID createdBy,
        Instant updatedAt,
        UUID updatedBy) {

    public PartnerProfileView {
        sections = Set.copyOf(sections);
    }
}
