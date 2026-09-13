package az.ideanest.payment;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.support.ProductionClasses;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * §9.4's last sentence, checked rather than described (#61).
 *
 * <p>"No provider SDK is called anywhere except behind this interface. Changing provider
 * must be a single-file change."
 *
 * <p><strong>That is not a style preference.</strong> §9.3 ends with "integrate at least
 * two providers — if the primary is unavailable on the day a large campaign closes, the
 * entire business stops", and a second integration is only a day's work if the first
 * one's vocabulary never leaked. The moment a decline code, an amount in minor units, or
 * a status string from one provider reaches the collection run, the second provider
 * becomes a rewrite of everything that touched it.
 *
 * <p>{@code ModuleBoundaryTests} makes the same argument about §16.1's module boundary
 * and for the same reason: a rule that lives only in a comment survives until the first
 * afternoon somebody is in a hurry.
 */
class PaymentProviderBoundaryTests {

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

    /**
     * <strong>One adapter ships, Epoint's (IDN-EXT-01, #38).</strong> This used to assert that no
     * adapter shipped at all, §9.2's refusal of a stub; it now names the one real adapter, so a
     * convenient fake added to get a demo working still fails the build.
     *
     * <p>What it replaced said:
     *
     * <p>§9.2 says why no stub is written in the meantime: one that returned an approval
     * "would make this path look finished and would have told clients that cards were
     * verified when no card was ever seen". This is that decision, asserted — so the day
     * somebody adds a convenient fake to get a demo working, the build says so.
     *
     * <p>The real first adapter will fail this test, and the person writing it should
     * delete the assertion in the same change that adds the adapter, having read §9.3's
     * fourteen requirements and confirmed them in writing. That is the friction it exists
     * to create.
     */
    @Test
    @DisplayName("IDN-EXT-01: the only payment provider adapter is Epoint's")
    void onlyEpointShips() {
        List<String> implementations = PRODUCTION_CLASSES.stream()
                .filter(candidate -> candidate.isAssignableTo(PaymentProvider.class))
                .filter(candidate -> !candidate.isInterface())
                .map(JavaClass::getName)
                .toList();

        assertThat(implementations)
                .withFailMessage(
                        "The production PaymentProvider adapters are %s.%n"
                                + "§9.2 refuses a stub. If this is a second real adapter, name it here in the"
                                + " same change.",
                        String.join(", ", implementations))
                .containsExactly("az.ideanest.payment.infrastructure.EpointPaymentProvider");
    }

    /**
     * The provider's vocabulary stays inside the payment module.
     *
     * <p>Stated as "nothing outside {@code az.ideanest.payment} names any of these types",
     * which is the checkable form of "a provider change is a single-file change": if the
     * ledger, the pledge module or a controller could hold a {@code ChargeResult}, then
     * changing what a provider answers would change them too.
     *
     * <p>The exception is {@code shared}, which names nothing here and is asserted not to.
     */
    @Test
    @DisplayName("no module outside payment names a provider request or result type")
    void theProvidersVocabularyStaysInsideTheModule() {
        noClasses()
                .that()
                .resideOutsideOfPackage("az.ideanest.payment..")
                .should()
                .dependOnClassesThat()
                .resideInAPackage("az.ideanest.payment.domain..")
                .because("§9.4: a provider change must be a single-file change, which it cannot be"
                        + " if another module holds a ChargeResult or a ProviderName")
                .check(PRODUCTION_CLASSES);
    }
}
