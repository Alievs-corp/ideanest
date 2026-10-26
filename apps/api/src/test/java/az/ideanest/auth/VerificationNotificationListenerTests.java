package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AuthEvents.PasswordResetRequested;
import az.ideanest.auth.application.VerificationNotificationListener;
import az.ideanest.auth.application.VerificationNotifier;
import az.ideanest.shared.EmailAddress;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * That auth mail is sent off the request's thread (#587).
 *
 * <p>The integration suite runs with {@code synchronous-mail} on, so that a test can read
 * the token a message carried as soon as the request returns. This is where the setting
 * every deployment runs is exercised: the listener is built as production builds it, and
 * the notifier behind it is a relay that does not answer until the test lets it.
 */
class VerificationNotificationListenerTests {

    private static final EmailAddress ADDRESS = EmailAddress.of("registered@example.com");

    private static final PasswordResetRequested RESET = new PasswordResetRequested(ADDRESS, "a-token", "en");

    /** A relay that holds every message until it is released. */
    private static class SlowRelay implements VerificationNotifier {

        private final CountDownLatch release = new CountDownLatch(1);
        private final CountDownLatch sent = new CountDownLatch(1);
        private final AtomicReference<String> sentOn = new AtomicReference<>();

        @Override
        public void sendPasswordReset(EmailAddress email, String token, String locale) {
            try {
                release.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            sentOn.set(Thread.currentThread().getName());
            sent.countDown();
        }

        @Override
        public void sendEmailVerification(EmailAddress email, String token, String locale) {
        }

        @Override
        public void sendRegistrationAttemptOnExistingAccount(EmailAddress email, String locale) {
        }

        @Override
        public void sendPasswordChanged(EmailAddress email, String locale) {
        }

        @Override
        public void sendEmailChangeConfirmation(EmailAddress newEmail, String token, String locale) {
        }

        @Override
        public void sendEmailChangeNotice(EmailAddress previousEmail, EmailAddress newEmail, String locale) {
        }

        @Override
        public void sendEmailChangeAttemptOnExistingAccount(EmailAddress email, String locale) {
        }
    }

    private static AuthProperties properties(boolean synchronousMail) {
        return new AuthProperties(
                null, null, null, 12, 256, null, null, null, null, null, null, false, synchronousMail);
    }

    @Test
    @DisplayName("a reset link is handed to the mail pool, and the request does not wait for the relay")
    void theRequestDoesNotWaitForTheRelay() throws Exception {
        SlowRelay relay = new SlowRelay();
        VerificationNotificationListener listener = new VerificationNotificationListener(relay, properties(false));
        try {
            long started = System.nanoTime();
            listener.onPasswordResetRequested(RESET);
            Duration took = Duration.ofNanos(System.nanoTime() - started);

            // The relay has not answered, and the listener has already returned: the
            // request thread is free, so a registered address answers as quickly as an
            // unknown one, which sends nothing at all.
            assertThat(relay.sent.getCount()).isEqualTo(1);
            assertThat(took).isLessThan(Duration.ofSeconds(1));

            relay.release.countDown();
            assertThat(relay.sent.await(10, TimeUnit.SECONDS)).isTrue();
            assertThat(relay.sentOn.get()).startsWith("auth-mail-");
        } finally {
            relay.release.countDown();
            listener.destroy();
        }
    }

    @Test
    @DisplayName("with synchronous mail, the message is sent before the listener returns")
    void synchronousMailIsSentInline() throws Exception {
        SlowRelay relay = new SlowRelay();
        relay.release.countDown();
        VerificationNotificationListener listener = new VerificationNotificationListener(relay, properties(true));

        listener.onPasswordResetRequested(RESET);

        assertThat(relay.sent.getCount()).isZero();
        assertThat(relay.sentOn.get()).isEqualTo(Thread.currentThread().getName());
        listener.destroy();
    }

    @Test
    @DisplayName("a relay that throws does not take the pool's thread with it")
    void aFailureIsContained() throws Exception {
        CountDownLatch second = new CountDownLatch(1);
        VerificationNotifier failing = new SlowRelay() {
            private final AtomicBoolean first = new AtomicBoolean(true);

            @Override
            public void sendPasswordReset(EmailAddress email, String token, String locale) {
                if (first.getAndSet(false)) {
                    throw new IllegalStateException("the relay went away");
                }
                second.countDown();
            }
        };
        VerificationNotificationListener listener = new VerificationNotificationListener(failing, properties(false));
        try {
            listener.onPasswordResetRequested(RESET);
            listener.onPasswordResetRequested(RESET);

            assertThat(second.await(10, TimeUnit.SECONDS)).isTrue();
        } finally {
            listener.destroy();
        }
    }
}
