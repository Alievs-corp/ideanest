package az.ideanest;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.ProductionClasses;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The module boundary, checked rather than described.
 *
 * <p>{@code az/ideanest/package-info.java} states the rules. A rule that lives
 * only in a comment survives until the first afternoon somebody is in a hurry,
 * and the cost of finding out later is that extracting a module stops being a
 * contained piece of work.
 */
class ModuleBoundaryTests {

    private static final String ROOT = "az.ideanest";

    /**
     * Cross-cutting by definition: money, identifiers, the outbox, idempotency,
     * auditing. Everything may depend on it, which is exactly why nothing that
     * belongs to one feature is allowed to be put here.
     */
    private static final String SHARED = "shared";

    /**
     * The one class #236 is about: the enum that decides every capability check.
     *
     * <p>Named as a string rather than imported, so that the rule below cannot be
     * satisfied by this test file moving with it.
     */
    private static final String CAPABILITY = "az.ideanest.project.domain.Capability";

    /** Where the vocabulary is published, and the only sanctioned way to name one. */
    private static final String PROJECT_CAPABILITY = "az.ideanest.shared.access.ProjectCapability";

    /** Staff identity, published for the same reason and asked the same way. */
    private static final String PLATFORM_STAFF = "az.ideanest.shared.access.PlatformStaff";

    /**
     * The one #245 is about: who a message about a campaign goes to, when the answer is rows
     * another module owns.
     */
    private static final String PROJECT_AUDIENCES = "az.ideanest.shared.audience.ProjectAudiences";

    /**
     * The other half of #245, which arrived with #90: what a module implements when it owns the
     * rows behind an audience.
     *
     * <p>Two types rather than one because there are now two answering modules — the pledge
     * module for {@code BACKERS}, the community module for {@code SAVERS} and
     * {@code FOLLOWERS} — and one interface with two implementations is an injection failure
     * rather than a port.
     */
    private static final String PROJECT_AUDIENCE_SOURCE = "az.ideanest.shared.audience.ProjectAudienceSource";

    /**
     * The one #249 is about: what a campaign is called, when the answer is a row another
     * module owns.
     */
    private static final String PROJECT_SUMMARIES = "az.ideanest.shared.project.ProjectSummaries";

    /**
     * Where a creator is paid, asked across the boundary — #432, and since #394 the only route
     * by which a creator's IBAN leaves the compliance module.
     */
    private static final String PAYOUT_DESTINATIONS = "az.ideanest.shared.compliance.PayoutDestinations";

    /**
     * One import, shared with every other ArchUnit suite — see {@link ProductionClasses}.
     *
     * <p>Each suite used to build its own, and five identical object graphs alive at once in one
     * test worker is what turned the {@code test} task into an {@code OutOfMemoryError} with no
     * test failing.
     */
    private static final JavaClasses PRODUCTION_CLASSES = ProductionClasses.get();

    @Test
    @DisplayName("there are classes to check")
    void classesWereImported() {
        assertThat(PRODUCTION_CLASSES).isNotEmpty();
    }

    @Test
    @DisplayName("a module does not reach into another module's internals")
    void modulesDoNotReachIntoEachOther() {
        List<String> violations = new ArrayList<>();

        for (JavaClass source : PRODUCTION_CLASSES) {
            String sourceModule = moduleOf(source.getPackageName());
            if (sourceModule == null) {
                continue;
            }
            for (JavaClass target : source.getDirectDependenciesFromSelf().stream()
                    .map(dependency -> dependency.getTargetClass())
                    .toList()) {
                String targetPackage = target.getPackageName();
                String targetModule = moduleOf(targetPackage);
                if (targetModule == null || targetModule.equals(sourceModule) || SHARED.equals(targetModule)) {
                    continue;
                }
                boolean internal = targetPackage.contains(".domain") || targetPackage.contains(".infrastructure");
                if (internal) {
                    violations.add("%s reaches into %s".formatted(source.getName(), target.getName()));
                }
            }
        }

        // Reaching another module's domain or infrastructure couples the two to
        // each other's internals. Modules talk through their application layer,
        // which is the only part either side agreed to keep stable.
        assertThat(violations)
                .withFailMessage(
                        "A module reached into another module's internals:%n  %s%n"
                                + "Modules talk through their application layer.",
                        String.join("\n  ", violations))
                .isEmpty();
    }

    @Test
    @DisplayName("no module names the project module's capability enum, and the contract is why they need not")
    void capabilitiesCrossOnlyThroughTheSharedContract() {
        // The rule that produced the defect #236 fixed, and it is kept. Four modules
        // wanted a fine-grained permission check, could not name this enum, and each
        // settled for the coarsest question the project module happened to publish —
        // so a collaborator granted only EDIT_REWARDS could publish a project update
        // and read the referral report. The answer is not to relax this; it is that
        // the vocabulary is published separately, which the second half asserts.
        noClasses()
                .that()
                .resideOutsideOfPackage("az.ideanest.project..")
                .should()
                .dependOnClassesThat()
                .haveFullyQualifiedName(CAPABILITY)
                .because("the capability vocabulary crosses as " + PROJECT_CAPABILITY + ", never as " + CAPABILITY)
                .check(PRODUCTION_CLASSES);

        // And the route is real rather than merely available: these are the four call
        // sites of #236, and a regression to the coarse check drops the module out of
        // this list rather than passing quietly.
        assertThat(modulesNaming(PROJECT_CAPABILITY))
                .withFailMessage(
                        "A module stopped asking for a named capability. Expected reward, community and"
                                + " analytics to name %s; found %s.",
                        PROJECT_CAPABILITY, modulesNaming(PROJECT_CAPABILITY))
                .contains("reward", "community", "analytics");
        assertThat(modulesNaming(PLATFORM_STAFF)).contains("moderation");
    }

    @Test
    @DisplayName("a computed audience crosses only through the shared contract")
    void audiencesCrossOnlyThroughTheSharedContract() {
        // #245's shape, and the same one #236 arrived at. §4.10 has notifications whose
        // audience is a list the platform computes -- a campaign's backers, a creator's
        // followers -- and the notification module cannot compute one without reading
        // `pledges`, `saves` or `follows`. The wrong answers were available and both are
        // worse: reach into the owning module, which the rule above forbids, or put the whole
        // audience in the event, which is ten thousand identifiers in a message.
        assertThat(modulesNaming(PROJECT_AUDIENCES))
                .withFailMessage(
                        "The notification module stopped asking for a published audience. Expected it to name"
                                + " %s; found %s.",
                        PROJECT_AUDIENCES, modulesNaming(PROJECT_AUDIENCES))
                .contains("notification");

        // And the answers come from the modules that own the rows. Both of them, since #90:
        // `pledges` is the pledge module's and `saves`/`follows` are the community module's,
        // so a single implementation could not exist without one of them reading the other's
        // tables. If `shared` ever answered this itself, `shared` would have acquired a
        // feature.
        assertThat(modulesNaming(PROJECT_AUDIENCE_SOURCE))
                .withFailMessage(
                        "An audience is answered by the module that owns the rows behind it. Expected the pledge"
                                + " and community modules to name %s; found %s.",
                        PROJECT_AUDIENCE_SOURCE, modulesNaming(PROJECT_AUDIENCE_SOURCE))
                .contains("pledge", "community");

        // The asking side names the question and never a source: a caller that reached for a
        // ProjectAudienceSource would be picking which module answers, which is the routing
        // decision RoutedProjectAudiences exists to own.
        assertThat(modulesNaming(PROJECT_AUDIENCE_SOURCE))
                .withFailMessage("The notification module should ask the question, not choose an answerer.")
                .doesNotContain("notification");
    }

    @Test
    @DisplayName("a campaign's name crosses only through the shared contract")
    void campaignNamesCrossOnlyThroughTheSharedContract() {
        // #249's shape, and the third instance of #236's. Every notification about a
        // campaign called it "this campaign", because a translation may not read `projects`
        // to find out what it is called. The wrong answers were the same two as before:
        // reach into the project module, or look the title up when the message is sent --
        // which would render the title as it is now rather than as it was when the thing
        // happened, and would do it inside the delivery loop for every recipient.
        assertThat(modulesNaming(PROJECT_SUMMARIES))
                .withFailMessage(
                        "The notification module stopped asking for a published campaign summary. Expected it"
                                + " to name %s; found %s.",
                        PROJECT_SUMMARIES, modulesNaming(PROJECT_SUMMARIES))
                .contains("notification");

        // And the implementation is the project module's, because `projects` is its table.
        assertThat(modulesNaming(PROJECT_SUMMARIES)).contains("project");
    }

    @Test
    @DisplayName("a creator's bank account crosses only through the shared contract")
    void bankAccountsCrossOnlyThroughTheSharedContract() {
        // #394. The payout module will pay creators by bank transfer and needs the IBAN to do
        // it, and it may no more read `payout_destinations` than `identity_verifications`. The
        // wrong answers are the familiar two: reach into compliance's domain for the row and
        // open the ciphertext itself -- which would put the capability check and the audit row
        // on whichever side remembered them -- or copy the IBAN into a payout. So the payout
        // module names the question, and compliance answers it with the check and the audit.
        assertThat(modulesNaming(PAYOUT_DESTINATIONS))
                .withFailMessage(
                        "The payout module stopped asking for a published payout destination. Expected it to"
                                + " name %s; found %s.",
                        PAYOUT_DESTINATIONS, modulesNaming(PAYOUT_DESTINATIONS))
                .contains("payout", "compliance");

        noClasses()
                .that()
                .resideOutsideOfPackage("az.ideanest.compliance..")
                .should()
                .dependOnClassesThat()
                .haveFullyQualifiedName("az.ideanest.compliance.domain.PayoutDestination")
                .orShould()
                .dependOnClassesThat()
                .haveFullyQualifiedName("az.ideanest.compliance.domain.Iban")
                .because("a creator's account crosses as " + PAYOUT_DESTINATIONS + ", which checks and audits")
                .check(PRODUCTION_CLASSES);
    }

    @Test
    @DisplayName("domain does not depend on infrastructure or api")
    void domainStaysIndependentOfItsPlumbing() {
        // The rules of the business do not know they are stored in PostgreSQL or
        // reached over HTTP. When they start to, they can no longer be tested
        // without both.
        noClasses()
                .that()
                .resideInAPackage("..domain..")
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage("..infrastructure..", "..api..")
                .check(PRODUCTION_CLASSES);
    }

    @Test
    @DisplayName("no cycles between modules")
    void modulesAreAcyclic() {
        // Two modules that depend on each other are one module with a naming
        // convention, and neither can be extracted or reasoned about alone.
        slices().matching(ROOT + ".(*)..").should().beFreeOfCycles().check(PRODUCTION_CLASSES);
    }

    /** Which modules depend on a published contract type, by simple module name. */
    private static List<String> modulesNaming(String contractType) {
        List<String> modules = new ArrayList<>();
        for (JavaClass source : PRODUCTION_CLASSES) {
            String module = moduleOf(source.getPackageName());
            if (module == null || SHARED.equals(module) || modules.contains(module)) {
                continue;
            }
            boolean names = source.getDirectDependenciesFromSelf().stream()
                    .anyMatch(dependency -> dependency.getTargetClass().getName().equals(contractType));
            if (names) {
                modules.add(module);
            }
        }
        return modules;
    }

    /** The module a package belongs to, or null for the root package itself. */
    private static String moduleOf(String packageName) {
        if (!packageName.startsWith(ROOT + ".")) {
            return null;
        }
        String remainder = packageName.substring(ROOT.length() + 1);
        int dot = remainder.indexOf('.');
        return dot < 0 ? remainder : remainder.substring(0, dot);
    }
}
