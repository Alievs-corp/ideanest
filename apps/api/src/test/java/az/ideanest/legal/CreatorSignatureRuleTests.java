package az.ideanest.legal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * When a creator agreement must be signed rather than ticked — issue #429's rule, without
 * #424's number.
 *
 * <p>A unit test, because the rule is a pure function of a goal and a subject kind. What it
 * pins down is mostly what the rule refuses to do on its own: with {@code enabled} false it
 * demands nothing of anybody, which is the state a deployment is in until #424 answers and is
 * the state #429 forbids replacing with "everybody signs".
 */
class CreatorSignatureRuleTests {

    private static final BigDecimal SMALL = new BigDecimal("500.00");
    private static final BigDecimal LARGE = new BigDecimal("50000.00");
    private static final BigDecimal CEILING = new BigDecimal("5000.00");

    @Test
    @DisplayName("off by default, and off means nobody signs — not even a company raising fifty thousand")
    void defaultsToDemandingNothing() {
        LegalProperties.Signature rule = LegalProperties.Signature.defaults();

        assertThat(rule.enabled()).isFalse();
        assertThat(rule.isRequiredFor(SMALL, false)).isFalse();
        assertThat(rule.isRequiredFor(LARGE, true)).isFalse();
        assertThat(rule.isRequiredFor(null, true)).isFalse();
    }

    @Test
    @DisplayName("a whole LegalProperties with nothing configured is the same, so a missing block is not a demand")
    void missingConfigurationIsNotADemand() {
        assertThat(new LegalProperties(null, null).signature().isRequiredFor(LARGE, true)).isFalse();
    }

    @Test
    @DisplayName("above the ceiling, a signature is required; below it, an acceptance is enough")
    void theCeiling() {
        LegalProperties.Signature rule = new LegalProperties.Signature(true, CEILING, false);

        assertThat(rule.isRequiredFor(SMALL, false)).isFalse();
        // Strictly above. A campaign whose goal is exactly the ceiling is below the line,
        // which is the reading that puts fewer people through the friction.
        assertThat(rule.isRequiredFor(CEILING, false)).isFalse();
        assertThat(rule.isRequiredFor(LARGE, false)).isTrue();
    }

    @Test
    @DisplayName("a registered entity signs regardless of amount, when that is configured")
    void theLegalEntity() {
        LegalProperties.Signature both = new LegalProperties.Signature(true, CEILING, true);
        assertThat(both.isRequiredFor(SMALL, true)).isTrue();

        LegalProperties.Signature amountOnly = new LegalProperties.Signature(true, CEILING, false);
        assertThat(amountOnly.isRequiredFor(SMALL, true)).isFalse();
    }

    @Test
    @DisplayName("no ceiling means amount alone never requires one")
    void noCeiling() {
        // #424 may answer "companies always, individuals never", and that answer must be
        // expressible without inventing a number to stand in for infinity.
        LegalProperties.Signature entityOnly = new LegalProperties.Signature(true, null, true);

        assertThat(entityOnly.isRequiredFor(LARGE, false)).isFalse();
        assertThat(entityOnly.isRequiredFor(SMALL, true)).isTrue();
    }

    @Test
    @DisplayName("a campaign with no goal yet is not above any ceiling")
    void noGoal() {
        LegalProperties.Signature rule = new LegalProperties.Signature(true, CEILING, false);
        assertThat(rule.isRequiredFor(null, false)).isFalse();
    }

    @Test
    @DisplayName("a negative ceiling is refused rather than quietly meaning everybody")
    void negativeCeiling() {
        assertThatThrownBy(() -> new LegalProperties.Signature(true, new BigDecimal("-1"), false))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
