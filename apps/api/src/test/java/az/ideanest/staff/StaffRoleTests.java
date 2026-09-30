package az.ideanest.staff;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.application.StaffMember;
import az.ideanest.staff.domain.StaffRole;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * What each role confers, and what the separation is for — issue #295.
 *
 * <p>#295 states the problem the old configured list had in one line: it "cannot express
 * 'may refund' against 'may moderate'". These assertions are that sentence, checked — a role
 * model whose roles all confer everything is the list it replaced, spelled differently.
 *
 * <p>A plain unit test: none of this is about persistence. What is in the database is which
 * roles an account holds; what each role means is a policy in {@link StaffRole}, and that is
 * exactly the thing a reviewer should be able to see change in a diff.
 */
class StaffRoleTests {

    @Test
    @DisplayName("moderating and refunding are held by different roles")
    void moderationAndMoneyAreSeparate() {
        // The whole of #295, as one assertion. If this ever passes trivially -- because both
        // roles gained both capabilities -- the role model has quietly become the list.
        assertThat(StaffRole.MODERATOR.capabilities()).contains(StaffCapability.MODERATE_CONTENT);
        assertThat(StaffRole.MODERATOR.capabilities()).doesNotContain(StaffCapability.ISSUE_REFUND);

        assertThat(StaffRole.FINANCE.capabilities()).contains(StaffCapability.ISSUE_REFUND);
        assertThat(StaffRole.FINANCE.capabilities()).doesNotContain(StaffCapability.MODERATE_CONTENT);
    }

    @Test
    @DisplayName("finance cannot approve the payouts it calculates")
    void financeCannotApproveItsOwnPayouts() {
        // §4.11 requires dual approval above a threshold, and a role conferring both issuing
        // and approving would make the second signature a formality whenever the finance team
        // is one person. APPROVE_PAYOUT is ADMINISTRATOR's alone, so the second signature is
        // somebody else by construction rather than by policy.
        assertThat(StaffRole.FINANCE.capabilities()).doesNotContain(StaffCapability.APPROVE_PAYOUT);
        assertThat(StaffRole.ADMINISTRATOR.capabilities()).contains(StaffCapability.APPROVE_PAYOUT);
    }

    @Test
    @DisplayName("only an administrator may grant a role")
    void onlyAdministratorsGrantRoles() {
        // Anybody who can grant themselves a capability effectively holds every capability,
        // so this is the check that decides what the rest of the enum is worth.
        for (StaffRole role : StaffRole.values()) {
            assertThat(role.capabilities().contains(StaffCapability.ADMINISTER_STAFF))
                    .withFailMessage("%s must not be able to grant roles", role)
                    .isEqualTo(role.isSuperAdmin());
        }
    }

    @Test
    @DisplayName("an administrator holds everything")
    void administratorHoldsEverything() {
        assertThat(StaffRole.ADMINISTRATOR.capabilities())
                .containsExactlyInAnyOrder(StaffCapability.values());
    }

    @Test
    @DisplayName("a super admin holds everything, exactly as the administrator it replaces")
    void superAdminHoldsEverything() {
        // The rename is two releases (V88), so for one of them both names are live and a
        // difference between them would be a role that behaves differently depending on
        // which row an account happened to be granted before the deployment.
        assertThat(StaffRole.SUPER_ADMIN.capabilities())
                .containsExactlyInAnyOrder(StaffCapability.values())
                .isEqualTo(StaffRole.ADMINISTRATOR.capabilities());
        assertThat(StaffRole.SUPER_ADMIN.isSuperAdmin()).isTrue();
        assertThat(StaffRole.ADMINISTRATOR.isSuperAdmin()).isTrue();
    }

    @Test
    @DisplayName("only the two names of the highest role count as the highest role")
    void onlyTheTwoNamesAreSuperAdmin() {
        for (StaffRole role : StaffRole.values()) {
            assertThat(role.isSuperAdmin())
                    .withFailMessage("%s must not count as a super admin", role)
                    .isEqualTo(role == StaffRole.SUPER_ADMIN || role == StaffRole.ADMINISTRATOR);
        }
    }

    @Test
    @DisplayName("a partner holds the statistics capability and nothing else")
    void partnerHoldsOnlyTheStatistics() {
        assertThat(StaffRole.PARTNER.capabilities())
                .containsExactly(StaffCapability.VIEW_PARTNER_STATISTICS);
    }

    @Test
    @DisplayName("a partner cannot read a transaction, an account or the audit trail")
    void partnerSeesNoIndividualRecord() {
        // The whole point of the role. VIEW_FINANCE opens the payments journal and ledger,
        // ADMINISTER_ACCOUNTS opens who paid, and VIEW_AUDIT names both in every row. A
        // partner is owed a share of the totals and none of those.
        assertThat(StaffRole.PARTNER.capabilities())
                .doesNotContain(
                        StaffCapability.VIEW_FINANCE,
                        StaffCapability.ISSUE_REFUND,
                        StaffCapability.MANAGE_DISPUTES,
                        StaffCapability.APPROVE_PAYOUT,
                        StaffCapability.ADMINISTER_ACCOUNTS,
                        StaffCapability.ADMINISTER_STAFF,
                        StaffCapability.CONFIGURE_PLATFORM,
                        StaffCapability.VIEW_AUDIT);
    }

    @Test
    @DisplayName("no role other than a super admin holds the partner statistics")
    void onlySuperAdminsAndPartnersReadPartnerStatistics() {
        for (StaffRole role : StaffRole.values()) {
            assertThat(role.capabilities().contains(StaffCapability.VIEW_PARTNER_STATISTICS))
                    .withFailMessage("%s must not read the partner statistics", role)
                    .isEqualTo(role.isSuperAdmin() || role == StaffRole.PARTNER);
        }
    }

    @Test
    @DisplayName("the curator role touches no personal data")
    void curatorIsTheNarrowestRole() {
        // The reason it exists at all: arranging the home page should not require being
        // trusted with the report queue or with anybody's email address.
        assertThat(StaffRole.CURATOR.capabilities())
                .doesNotContain(
                        StaffCapability.ADMINISTER_ACCOUNTS,
                        StaffCapability.MODERATE_CONTENT,
                        StaffCapability.HANDLE_SUPPORT,
                        StaffCapability.VIEW_FINANCE);
    }

    @ParameterizedTest
    @DisplayName("every role can read the audit trail")
    @EnumSource(value = StaffRole.class, mode = EnumSource.Mode.EXCLUDE, names = "PARTNER")
    void everyRoleCanReadTheTrail(StaffRole role) {
        // Deliberately wide. A trail only the people it would incriminate can read is a
        // trail; a trail every member of staff can read is a control. PARTNER is the one
        // exception, and partnerSeesNoIndividualRecord says why: the trail names accounts
        // and amounts, which is what a partner must not see.
        assertThat(role.capabilities()).contains(StaffCapability.VIEW_AUDIT);
    }

    @Test
    @DisplayName("holding two roles holds the union of both")
    void rolesAreAdditive() {
        Set<StaffCapability> union = EnumSet.noneOf(StaffCapability.class);
        union.addAll(StaffRole.MODERATOR.capabilities());
        union.addAll(StaffRole.FINANCE.capabilities());

        StaffMember member = new StaffMember(
                UUID.randomUUID(), Set.of(StaffRole.MODERATOR, StaffRole.FINANCE), union, false);

        // Union rather than intersection or precedence, because no role here takes a
        // capability away -- so there is nothing for a precedence rule to resolve.
        assertThat(member.holds(StaffCapability.MODERATE_CONTENT)).isTrue();
        assertThat(member.holds(StaffCapability.ISSUE_REFUND)).isTrue();
        assertThat(member.holds(StaffCapability.APPROVE_PAYOUT)).isFalse();
        assertThat(member.isStaff()).isTrue();
    }

    @Test
    @DisplayName("an account with no roles is not staff and holds nothing")
    void nobodyIsNotStaff() {
        StaffMember nobody = StaffMember.none(UUID.randomUUID());

        assertThat(nobody.isStaff()).isFalse();
        for (StaffCapability capability : StaffCapability.values()) {
            assertThat(nobody.holds(capability)).isFalse();
        }
    }

    @Test
    @DisplayName("opening an identity document is narrower than moderation")
    void openingAnIdentityDocumentIsNarrowerThanModeration() {
        // #436's central argument, checked. V58 encrypts identity documents in the
        // application, keeps them for days rather than for the life of the account, and audits
        // every opening -- and that design assumes a small number of people. Folded into
        // MODERATE_CONTENT the capability would be held by everybody who reviews a reported
        // comment, and the retention sweep would be protecting a photograph of somebody's
        // passport from nobody.
        assertThat(StaffRole.MODERATOR.capabilities())
                .doesNotContain(
                        StaffCapability.OPEN_IDENTITY_DOCUMENT,
                        StaffCapability.REVIEW_IDENTITY_VERIFICATION,
                        StaffCapability.READ_SIGNED_AGREEMENT);

        assertThat(StaffRole.COMPLIANCE.capabilities())
                .contains(StaffCapability.OPEN_IDENTITY_DOCUMENT, StaffCapability.REVIEW_IDENTITY_VERIFICATION);
    }

    @Test
    @DisplayName("compliance verifies a payout destination and finance sends money to it")
    void verifyingADestinationIsNotFinances() {
        // §4.11's dual approval, one step earlier in the same sequence. The role that decides
        // where money goes must not also be the role that certifies the destination is
        // correct -- otherwise one person holds both halves, which is the arrangement the
        // dual-approval rule exists to prevent. V66's header records the decision.
        assertThat(StaffRole.FINANCE.capabilities()).doesNotContain(StaffCapability.VERIFY_PAYOUT_DESTINATION);
        assertThat(StaffRole.COMPLIANCE.capabilities()).contains(StaffCapability.VERIFY_PAYOUT_DESTINATION);
    }

    @Test
    @DisplayName("compliance cannot waive the rules it enforces")
    void complianceCannotOverrideItself() {
        // The same argument a third time, and the reason overrides are ADMINISTRATOR's alone:
        // a reviewer who could waive the requirement they enforce holds both halves of it, and
        // the waiver stops being an exception anybody escalated for.
        assertThat(StaffRole.COMPLIANCE.capabilities()).doesNotContain(StaffCapability.GRANT_COMPLIANCE_OVERRIDE);
        assertThat(StaffRole.ADMINISTRATOR.capabilities()).contains(StaffCapability.GRANT_COMPLIANCE_OVERRIDE);
    }

    @Test
    @DisplayName("compliance reads identity and neither moderates nor reads the ledger")
    void complianceIsNarrow() {
        // Roles are additive, so somebody who does both jobs holds both roles -- which shows
        // on the staff screen. Widening MODERATOR instead would have hidden it.
        assertThat(StaffRole.COMPLIANCE.capabilities())
                .doesNotContain(
                        StaffCapability.MODERATE_CONTENT,
                        StaffCapability.VIEW_FINANCE,
                        StaffCapability.ADMINISTER_ACCOUNTS,
                        StaffCapability.CURATE);
    }

    @Test
    @DisplayName("publishing a legal document is no longer the fee schedule's capability")
    void publishingALegalDocumentIsItsOwnAuthority() {
        // It shipped under CONFIGURE_PLATFORM and V65 said #436 would narrow it. The two are
        // not the same decision: opening new fee terms prices the next payout and is undone by
        // opening further terms, and publishing a version of the creator agreement changes
        // what every creator submitting after it is bound by and cannot be undone at all.
        assertThat(StaffCapability.PUBLISH_LEGAL_DOCUMENT).isNotEqualTo(StaffCapability.CONFIGURE_PLATFORM);
        for (StaffRole role : StaffRole.values()) {
            if (role.isSuperAdmin()) {
                continue;
            }
            assertThat(role.capabilities())
                    .withFailMessage("%s must not be able to publish a legal document", role)
                    .doesNotContain(StaffCapability.PUBLISH_LEGAL_DOCUMENT);
        }
    }

    @Test
    @DisplayName("a consent history is not in front of everybody who clears the comment queue")
    void readingAnAcceptanceRecordIsNarrowerThanAdministeringAccounts() {
        // It was ADMINISTER_ACCOUNTS, which is also what a moderator holds in order to ban
        // somebody behind a report. Right module, wrong width -- #436 gave it a row.
        assertThat(StaffRole.MODERATOR.capabilities())
                .contains(StaffCapability.ADMINISTER_ACCOUNTS)
                .doesNotContain(StaffCapability.READ_ACCEPTANCE_RECORD);
    }

    @Test
    @DisplayName("every capability is conferred by at least one role")
    void noCapabilityIsUnreachable() {
        // A capability no role grants is an endpoint nobody can ever call, which is a
        // deployment with a screen that always refuses and no way to find out why.
        Set<StaffCapability> reachable = EnumSet.noneOf(StaffCapability.class);
        for (StaffRole role : StaffRole.values()) {
            reachable.addAll(role.capabilities());
        }

        assertThat(reachable).containsExactlyInAnyOrder(StaffCapability.values());
    }
}
