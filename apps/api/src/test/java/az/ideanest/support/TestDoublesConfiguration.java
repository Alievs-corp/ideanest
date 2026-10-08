package az.ideanest.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * The collaborators tests substitute.
 *
 * <p>Imported by {@link AbstractIntegrationTest} rather than per test class, so
 * that every integration test shares one context — and therefore one PostgreSQL
 * container. A test class that imported a different set would get a second
 * context and a second container for its trouble.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestDoublesConfiguration {

    @Bean
    @Primary
    RecordingVerificationNotifier recordingVerificationNotifier() {
        return new RecordingVerificationNotifier();
    }

    /**
     * The object store, as a directory on disk -- the media pipeline design of 2026-08-30.
     *
     * <p>Without it the upload path cannot be tested at all: an unconfigured deployment gets
     * a store that refuses everything, which is right in production and makes "upload a cover
     * and attach it" impossible to write. What is interesting is above the store anyway --
     * the state machine, the sweep's claim, the ownership check on attachment -- and none of
     * it is S3.
     */
    @Bean
    @Primary
    LocalObjectStore localObjectStore() {
        return new LocalObjectStore();
    }

    /**
     * The transcoder, scripted rather than spawning libvips.
     *
     * <p>The conversion is asserted against a real installation in
     * {@code VipsImageTranscoderTests}, on the bytes it produces. Requiring a native
     * dependency for the integration suite to start would make the suite one that does not
     * run; see {@code ScriptedImageTranscoder} for the full argument.
     */
    @Bean
    @Primary
    ScriptedImageTranscoder scriptedImageTranscoder() {
        return new ScriptedImageTranscoder();
    }

    /** The video transcoder, scripted for the same reason — issue #331. */
    @Bean
    @Primary
    ScriptedVideoTranscoder scriptedVideoTranscoder() {
        return new ScriptedVideoTranscoder();
    }

    /**
     * §21.2's rate source, scripted rather than fetched — issue #327.
     *
     * <p>The suite must never reach cbar.az: a test that fetched a public website would fail
     * for reasons that are not ours, on somebody else's schedule. It also could not produce
     * the cases that matter — a source that is down, one serving Friday's rates on Sunday,
     * a rate that has aged past its limit. The XML parsing is tested separately against a
     * document on disk, which is where a parser belongs.
     */
    @Bean
    @Primary
    ScriptedRateSource scriptedRateSource() {
        return new ScriptedRateSource();
    }

    /**
     * The collaborator invitation notifier, remembering rather than logging.
     *
     * <p>Here for the same reason as the one above: there is no mail transport, so a
     * test that wanted to accept an invitation would otherwise have to read the
     * token's hash out of the row and could never prove that the link sent to the
     * invitee is the link that works.
     */
    @Bean
    @Primary
    RecordingCollaboratorInvitationNotifier recordingCollaboratorInvitationNotifier() {
        return new RecordingCollaboratorInvitationNotifier();
    }

    /**
     * The launch reminder notifier, remembering rather than logging.
     *
     * <p>Here for the same reason as the two above. The questions this feature has
     * to answer — was everybody told, was anybody told twice, does a failed send
     * leave the row for the next pass — are all about what reached the port, and
     * the logging adapter cannot be asked any of them.
     */
    @Bean
    @Primary
    RecordingLaunchReminderNotifier recordingLaunchReminderNotifier() {
        return new RecordingLaunchReminderNotifier();
    }

    /**
     * The application clock, with a handle on it.
     *
     * <p>Free-running unless a test freezes it, so this changes nothing for the
     * tests that do not care. The ones that do — one-time passwords, challenge
     * expiry — would otherwise have to sleep, and a sleeping test is flaky
     * precisely when the machine is busy.
     */
    @Bean
    @Primary
    AdjustableClock adjustableClock() {
        return new AdjustableClock();
    }

    /**
     * A payment provider whose answers a test writes.
     *
     * <p><strong>The only implementation of {@code PaymentProvider} anywhere</strong>, and
     * it is here rather than in {@code src/main} because §9.2 refuses a stub in a
     * deployed environment: an adapter returning approvals would make the collection path
     * look finished and would tell clients cards had been verified. In the suite nobody is
     * told anything, and a scripted provider is the only way to exercise §9.6's schedule,
     * the circuit breaker and the ledger posting before #60 is answered.
     * {@code PaymentProviderBoundaryTests} asserts that {@code src/main} still contains
     * none.
     *
     * <p>Not {@code @Primary}: nothing else supplies one, and {@code PaymentProviders}
     * takes every {@code PaymentProvider} bean rather than one, so marking it primary
     * would say something untrue about a list.
     *
     * <p>The suite shares one context, so this bean is shared too. A test that scripts it
     * calls {@code reset()} first — see {@code AbstractIntegrationTest}.
     */
    @Bean
    ScriptedPaymentProvider scriptedPaymentProvider() {
        return new ScriptedPaymentProvider();
    }

    /**
     * A stored card for every pledge, because {@code payment_methods} does not exist.
     *
     * <p>Replaces {@code UnavailableStoredCards}, which answers "there is no card on file"
     * — true of the platform and fatal to any test of collection, since every attempt
     * would fail with {@code payment_method_missing} before a provider was asked. #55 is
     * what replaces it for real.
     *
     * <p>{@code @Primary} because {@code PaymentConfiguration} registers its own only
     * {@code @ConditionalOnMissingBean}, and the condition is evaluated against the
     * application context rather than this test configuration — so both can exist and the
     * primary is what gets injected.
     */
    @Bean
    @Primary
    ScriptedStoredCards scriptedStoredCards() {
        return new ScriptedStoredCards();
    }
}
