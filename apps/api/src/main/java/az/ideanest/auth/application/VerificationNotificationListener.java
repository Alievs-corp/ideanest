package az.ideanest.auth.application;

import az.ideanest.auth.AuthProperties;
import az.ideanest.auth.application.AuthEvents.EmailChangeAttemptedOnExistingAccount;
import az.ideanest.auth.application.AuthEvents.EmailChangeNoticeToPreviousAddress;
import az.ideanest.auth.application.AuthEvents.EmailChangeRequested;
import az.ideanest.auth.application.AuthEvents.EmailVerificationRequested;
import az.ideanest.auth.application.AuthEvents.PasswordChanged;
import az.ideanest.auth.application.AuthEvents.PasswordResetRequested;
import az.ideanest.auth.application.AuthEvents.RegistrationAttemptedOnExistingAccount;
import az.ideanest.shared.observability.CorrelationTaskDecorator;
import java.util.concurrent.Executor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Sends what registration announced, after the transaction that announced it
 * has committed — and off the request's thread.
 *
 * <p>Sending inside the transaction would mean sending a verification link for
 * an account that a later rollback removed, and a message cannot be unsent.
 * After commit the account definitely exists.
 *
 * <h2>Off the request's thread (#587)</h2>
 *
 * <p>An {@code AFTER_COMMIT} listener still runs on the thread that committed, so
 * every message here used to be an SMTP conversation the caller waited for. On
 * {@code forgot-password} that was an oracle the endpoint is otherwise careful not
 * to be: the answer is the same 202 for every address, but a registered address
 * answered after a round trip to the mail relay and an unknown one answered at once,
 * and the difference is hundreds of milliseconds. So the send is handed to a small
 * pool of its own and the request returns without waiting for it. What is left of
 * the difference is the token row the registered branch writes — milliseconds
 * inside one transaction, rather than a conversation with another server.
 *
 * <p><strong>Not the outbox (#135), and that is a decision.</strong> An outbox row
 * would also survive a crash, but these events carry the token itself — the only
 * copy outside the message, since the database keeps its hash. Writing it into
 * {@code outbox_events} would put a live credential in a table, its backups and its
 * retention window, which is a worse trade than the crash it would close. The window
 * that remains is the one this class always had: a crash between the commit and the
 * send costs a message, and the person asks for another.
 *
 * <p>A pool of its own rather than Boot's {@code applicationTaskExecutor}: declaring an
 * executor bean would quietly replace that one for everything else, and these messages
 * should neither queue behind other work nor hold it up. Two threads, so that one slow
 * relay conversation does not hold every other message; bounded, so that a mail outage
 * does not become a heap that grows with it.
 */
@Component
public class VerificationNotificationListener implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(VerificationNotificationListener.class);

    private static final int SENDERS = 2;

    /**
     * Messages waiting for a sender. Past this a message is dropped with an error,
     * which is what an SMTP refusal already does: the account is unchanged and the
     * person asks again. Every endpoint that sends is rate limited, so reaching it
     * means the relay has been gone for a long time.
     */
    private static final int QUEUE = 1_000;

    private final VerificationNotifier notifier;

    /** Null when the configuration asks for sending on the request's thread. */
    private final ThreadPoolTaskExecutor pool;

    private final Executor sender;

    public VerificationNotificationListener(VerificationNotifier notifier, AuthProperties properties) {
        this.notifier = notifier;
        if (properties.synchronousMail()) {
            this.pool = null;
            this.sender = Runnable::run;
        } else {
            this.pool = senders();
            this.sender = pool;
        }
    }

    private static ThreadPoolTaskExecutor senders() {
        ThreadPoolTaskExecutor pool = new ThreadPoolTaskExecutor();
        pool.setCorePoolSize(SENDERS);
        pool.setMaxPoolSize(SENDERS);
        pool.setQueueCapacity(QUEUE);
        pool.setThreadNamePrefix("auth-mail-");
        // The request's correlation, so that "sent the reset" and the request that
        // asked for it are one search in the logs rather than two.
        pool.setTaskDecorator(new CorrelationTaskDecorator());
        pool.setRejectedExecutionHandler((task, executor) -> log.error(
                "The auth mail queue is full; a message was dropped and the person has to ask again."));
        // A deploy waits for what is already queued: those requests were told 202.
        pool.setWaitForTasksToCompleteOnShutdown(true);
        pool.setAwaitTerminationSeconds(30);
        pool.initialize();
        return pool;
    }

    @Override
    public void destroy() {
        if (pool != null) {
            pool.shutdown();
        }
    }

    /**
     * Hands one message to the sender.
     *
     * <p>Caught here because nothing else would: on a pool thread an exception reaches
     * no caller, and the notifier already treats a refusal as "log it and move on".
     */
    private void send(String what, Runnable message) {
        sender.execute(() -> {
            try {
                message.run();
            } catch (RuntimeException failure) {
                log.error("Could not send the {}; the person has to ask for another.", what, failure);
            }
        });
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onVerificationRequested(EmailVerificationRequested event) {
        send("email verification", () ->
                notifier.sendEmailVerification(event.email(), event.token(), event.locale()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRegistrationAttemptOnExistingAccount(RegistrationAttemptedOnExistingAccount event) {
        send("registration attempt notice", () ->
                notifier.sendRegistrationAttemptOnExistingAccount(event.email(), event.locale()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPasswordResetRequested(PasswordResetRequested event) {
        send("password reset", () -> notifier.sendPasswordReset(event.email(), event.token(), event.locale()));
    }

    /**
     * The notice that a password changed.
     *
     * <p>After commit like everything else here, and the ordering matters more than
     * usual: a message saying "your password was changed" that arrives before the
     * change is committed — and is then rolled back — teaches people to ignore the
     * one message on this platform that is worth acting on immediately.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPasswordChanged(PasswordChanged event) {
        send("password change notice", () -> notifier.sendPasswordChanged(event.email(), event.locale()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onEmailChangeRequested(EmailChangeRequested event) {
        send("email change confirmation", () ->
                notifier.sendEmailChangeConfirmation(event.newEmail(), event.token(), event.locale()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onEmailChangeNotice(EmailChangeNoticeToPreviousAddress event) {
        send("email change notice", () ->
                notifier.sendEmailChangeNotice(event.previousEmail(), event.newEmail(), event.locale()));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onEmailChangeAttemptOnExistingAccount(EmailChangeAttemptedOnExistingAccount event) {
        send("email change attempt notice", () ->
                notifier.sendEmailChangeAttemptOnExistingAccount(event.email(), event.locale()));
    }
}
