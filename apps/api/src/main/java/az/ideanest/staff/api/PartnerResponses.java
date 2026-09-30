package az.ideanest.staff.api;

import az.ideanest.staff.application.PartnerAdministrationService;
import az.ideanest.staff.application.PartnerProfileView;
import az.ideanest.staff.domain.PartnerSection;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * What the partner management endpoints say — #204.
 *
 * <p>Percentages cross the API as strings with two decimals, the way money does. They multiply
 * money, and a client that parsed {@code 33.33} into a binary double and multiplied would be
 * producing the rounding error the platform's rule against floating-point money exists to keep
 * out.
 */
public final class PartnerResponses {

    private PartnerResponses() {}

    /**
     * One partner.
     *
     * @param percentage the share, such as {@code "50.00"}
     * @param sections the console sections opened to them, in name order
     */
    public record Partner(
            UUID accountId,
            String percentage,
            List<PartnerSection> sections,
            Instant createdAt,
            UUID createdBy,
            Instant updatedAt,
            UUID updatedBy) {

        static Partner of(PartnerProfileView view) {
            return new Partner(
                    view.accountId(),
                    view.percentage().toPlainString(),
                    view.sections().stream().sorted(Comparator.comparing(Enum::name)).toList(),
                    view.createdAt(),
                    view.createdBy(),
                    view.updatedAt(),
                    view.updatedBy());
        }
    }

    /**
     * Every partner, and the arithmetic the screen needs.
     *
     * @param allocated the sum of the percentages, such as {@code "80.00"}
     * @param remaining 100 minus that: the most a new partner could be given
     */
    public record Roster(List<Partner> partners, String allocated, String remaining) {

        static Roster of(PartnerAdministrationService.PartnerRoster roster) {
            return new Roster(
                    roster.partners().stream().map(Partner::of).toList(),
                    roster.allocated().toPlainString(),
                    roster.remaining().toPlainString());
        }
    }
}
