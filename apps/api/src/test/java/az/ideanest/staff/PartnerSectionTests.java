package az.ideanest.staff;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.domain.PartnerSection;
import az.ideanest.staff.domain.StaffRole;
import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * What a super admin can open to a partner, and what no setting can — #204, part of #202.
 *
 * <p>A plain unit test. The rule is a fact about which capabilities the sections confer, and
 * the place a reviewer should see it change is this diff: widening {@link PartnerSection} is how
 * a partner would come to read a transaction, so every capability it can add is named here and
 * every one that would leak money or people is refused by name.
 */
class PartnerSectionTests {

    /** Everything that opens an individual transaction, who made it, or an unscaled figure. */
    private static final Set<StaffCapability> NEVER_FOR_A_PARTNER = EnumSet.of(
            StaffCapability.VIEW_FINANCE,
            StaffCapability.ISSUE_REFUND,
            StaffCapability.MANAGE_DISPUTES,
            StaffCapability.APPROVE_PAYOUT,
            StaffCapability.CONFIGURE_PLATFORM,
            StaffCapability.VIEW_AUDIT,
            StaffCapability.ADMINISTER_ACCOUNTS,
            StaffCapability.ADMINISTER_STAFF,
            StaffCapability.HANDLE_SUPPORT,
            StaffCapability.MODERATE_CONTENT,
            StaffCapability.READ_ACCEPTANCE_RECORD,
            StaffCapability.READ_SIGNED_AGREEMENT,
            StaffCapability.REVIEW_IDENTITY_VERIFICATION,
            StaffCapability.OPEN_IDENTITY_DOCUMENT,
            StaffCapability.VERIFY_PAYOUT_DESTINATION,
            StaffCapability.GRANT_COMPLIANCE_OVERRIDE,
            StaffCapability.PUBLISH_LEGAL_DOCUMENT);

    @ParameterizedTest
    @DisplayName("no section opens a capability that reads a transaction, an account or an unscaled figure")
    @EnumSource(PartnerSection.class)
    void noSectionLeaksMoneyOrPeople(PartnerSection section) {
        assertThat(NEVER_FOR_A_PARTNER)
                .withFailMessage("%s must not confer %s", section, section.capability())
                .doesNotContain(section.capability());
    }

    @Test
    @DisplayName("the sections are exactly curation and health, so widening them is a change somebody reads")
    void theListIsShortAndClosed() {
        assertThat(PartnerSection.values()).containsExactly(PartnerSection.CURATION, PartnerSection.HEALTH);
        assertThat(PartnerSection.CURATION.capability()).isEqualTo(StaffCapability.CURATE);
        assertThat(PartnerSection.HEALTH.capability()).isEqualTo(StaffCapability.VIEW_HEALTH);
    }

    @Test
    @DisplayName("the role alone still confers only the statistics, whatever sections exist")
    void theRoleDoesNotAbsorbTheSections() {
        // Sections are added to a partner's capabilities at request time from their own rows. If
        // they leaked into the role, every partner would hold them.
        assertThat(StaffRole.PARTNER.capabilities()).containsExactly(StaffCapability.VIEW_PARTNER_STATISTICS);
    }
}
