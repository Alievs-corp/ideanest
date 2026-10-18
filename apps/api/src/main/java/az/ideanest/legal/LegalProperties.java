package az.ideanest.legal;

import java.math.BigDecimal;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * When a creator agreement must be signed rather than ticked — issue #429, as configuration.
 *
 * <h2>Why this is configuration and not a constant</h2>
 *
 * <p>#424 decides the threshold and #424 is blocked on #423's anti-money-laundering row. §22.1
 * says what happens if this repository decides instead: a threshold invented here "would be the
 * position a regulator reads back to us". So the shape of the rule lives in code and the number
 * lives in a file, and the day the answer arrives is a configuration change.
 *
 * <p>#429 is equally explicit about the wrong shortcut:
 *
 * <blockquote>
 * Do <strong>not</strong> hardcode "everybody signs" as a placeholder — an individual raising
 * 500 AZN sent to a state e-signature app is friction that will be blamed on the wrong thing.
 * </blockquote>
 *
 * <p>Hence {@link Signature#enabled()} defaults to false. With it off, an acceptance is an
 * acceptance, the submission gate is exactly what #426 built, and the signing flow is available
 * to any creator who wants to use it without being demanded of anybody. That is the honest
 * state of the platform until #424 answers, and it is a state the tests exercise deliberately
 * rather than a feature that is switched off because it does not work.
 *
 * <h2>The rule, as #429 states its shape</h2>
 *
 * <ul>
 *   <li>Below the ceiling, and {@code INDIVIDUAL}: a recorded acceptance may be enough
 *   <li>Above the ceiling, or {@code LEGAL_ENTITY}: a signature is required
 * </ul>
 *
 * <p>Both halves are separately configurable, because #424's fourth point is that they are
 * separable questions and its fifth asks whether a legal entity is ever required regardless of
 * amount.
 *
 * @param signature the creator-agreement signature rule
 * @param inForce when a version dated for the future is noticed taking effect
 */
@ConfigurationProperties(prefix = "ideanest.legal")
public record LegalProperties(Signature signature, InForce inForce) {

    public LegalProperties {
        signature = signature == null ? Signature.defaults() : signature;
        inForce = inForce == null ? InForce.defaults() : inForce;
    }

    /**
     * The {@code legal-taking-effect} job — a version published for a future date reaching
     * the website on that date rather than whenever the web's cache next expired.
     *
     * @param schedule a UTC cron, or {@code -} to register the job without scheduling it
     * @param lookback how far behind a pass looks for a date that passed. Longer than the
     *     interval between passes, so a pass missed to a restart or a lease held elsewhere is
     *     covered by the next one; the cost of the overlap is announcing the same change more
     *     than once, which drops a cache that is already fresh
     */
    public record InForce(String schedule, Duration lookback) {

        public static InForce defaults() {
            return new InForce(null, null);
        }

        public InForce {
            schedule = schedule == null || schedule.isBlank() ? "0 * * * * *" : schedule;
            lookback = lookback == null ? Duration.ofMinutes(10) : lookback;
            if (lookback.isNegative() || lookback.isZero()) {
                throw new IllegalArgumentException("A lookback is a positive duration");
            }
        }
    }

    /**
     * @param enabled whether any signature is required at all. Off until #424 answers
     * @param goalCeiling the campaign goal above which a signature is required, in the platform
     *     currency. {@code null} means amount alone never requires one
     * @param requiredForLegalEntity whether a registered entity signs regardless of amount
     */
    public record Signature(boolean enabled, BigDecimal goalCeiling, boolean requiredForLegalEntity) {

        public static Signature defaults() {
            return new Signature(false, null, true);
        }

        public Signature {
            if (goalCeiling != null && goalCeiling.signum() < 0) {
                throw new IllegalArgumentException("A goal ceiling is not negative");
            }
        }

        /**
         * Whether a campaign with this goal, submitted by this kind of subject, needs a signature.
         *
         * <p>A campaign with no goal yet cannot be above a ceiling. It also cannot be submitted —
         * {@code ProjectChecklistService} refuses that separately — so the case reached here is a
         * caller asking in advance, and the honest answer to "would this need signing" for a
         * campaign with no amount is no.
         *
         * @param goalAmount the campaign's goal, or null if it has none yet
         * @param legalEntity whether the creator's legal subject is a registered entity
         */
        public boolean isRequiredFor(BigDecimal goalAmount, boolean legalEntity) {
            if (!enabled) {
                return false;
            }
            if (legalEntity && requiredForLegalEntity) {
                return true;
            }
            return goalCeiling != null && goalAmount != null && goalAmount.compareTo(goalCeiling) > 0;
        }
    }
}
