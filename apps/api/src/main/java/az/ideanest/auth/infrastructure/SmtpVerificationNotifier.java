package az.ideanest.auth.infrastructure;

import az.ideanest.auth.AuthProperties;
import az.ideanest.auth.application.VerificationNotifier;
import az.ideanest.notification.application.TransactionalMail;
import az.ideanest.notification.application.TransactionalMailFailedException;
import az.ideanest.notification.application.TransactionalMailer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.ReaderLocale;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * {@link VerificationNotifier} over #86's transport, replacing the log line.
 *
 * <p>The stand-in this class removed said of itself that "without a real sender, a
 * deployed environment cannot complete registration". That is now false: the six messages
 * are composed by {@link AuthEmailComposer} and handed to {@link TransactionalMailer},
 * which renders them through the same layouts and sends them from the same envelope as
 * every notification.
 *
 * <h2>A refusal is logged, not propagated — and that is the trade</h2>
 *
 * <p>{@code VerificationNotificationListener} runs {@code AFTER_COMMIT}. By the time any
 * method here is called the account exists, the password has already changed, or the
 * address change is already recorded — so an exception thrown from here cannot undo
 * anything. What it can do is turn a successful registration into a 500, after which the
 * person tries again and is told the address is taken, which is the worst of the
 * available outcomes.
 *
 * <p>So a refusal is an {@code ERROR} in the log and nothing else. <strong>The
 * consequence is real and is not hidden: during a mail outage people register and no link
 * arrives.</strong> They recover by asking for another one; what closes the window
 * properly is #135's outbox, which writes the intent to send in the same transaction as
 * the account and retries it until a relay takes it. This class is the shape that outbox
 * will drain, not a substitute for it.
 *
 * <h2>The local log line survives</h2>
 *
 * <p>{@code ideanest.auth.log-verification-links} still writes the token itself, and is
 * still on in {@code local} and nowhere else. It is no longer a stand-in for sending —
 * the message goes to Mailpit as well — but it stays because reading a token out of the
 * log is how an integration test and a developer without a mail client follow a link. A
 * verification link in a production log is an account takeover for anybody who can read
 * logs, which is why the flag is not merely defaulted off but documented as local-only.
 */
@Component
public class SmtpVerificationNotifier implements VerificationNotifier {

    private static final Logger log = LoggerFactory.getLogger(SmtpVerificationNotifier.class);

    private final TransactionalMailer mailer;
    private final AuthEmailComposer composer;
    private final boolean logLinks;

    public SmtpVerificationNotifier(
            TransactionalMailer mailer, AuthEmailComposer composer, AuthProperties properties) {

        this.mailer = mailer;
        this.composer = composer;
        this.logLinks = properties.logVerificationLinks();
    }

    @Override
    public void sendEmailVerification(EmailAddress email, String token, String locale) {
        logToken("Verification token", email, token, locale);
        send(email, locale, "email verification", composer.verifyEmail(token, localeOf(locale)));
    }

    @Override
    public void sendRegistrationAttemptOnExistingAccount(EmailAddress email, String locale) {
        send(
                email,
                locale,
                "registration attempt notice",
                composer.registrationOnExistingAccount(localeOf(locale)));
    }

    @Override
    public void sendPasswordReset(EmailAddress email, String token, String locale) {
        logToken("Password reset token", email, token, locale);
        send(email, locale, "password reset", composer.passwordReset(token, localeOf(locale)));
    }

    @Override
    public void sendPasswordChanged(EmailAddress email, String locale) {
        send(email, locale, "password change notice", composer.passwordChanged(localeOf(locale)));
    }

    @Override
    public void sendEmailChangeConfirmation(EmailAddress newEmail, String token, String locale) {
        logToken("Email change token", newEmail, token, locale);
        send(
                newEmail,
                locale,
                "email change confirmation",
                composer.emailChangeConfirmation(token, localeOf(locale)));
    }

    @Override
    public void sendEmailChangeNotice(EmailAddress previousEmail, EmailAddress newEmail, String locale) {
        // The new address in full, to the old one. That is the fact the message carries,
        // and it goes to the person losing the account rather than to the person taking
        // it -- EmailAddress.toString masks, so it is read off value() deliberately.
        send(
                previousEmail,
                locale,
                "email change notice",
                composer.emailChangeNotice(newEmail.value(), localeOf(locale)));
    }

    @Override
    public void sendEmailChangeAttemptOnExistingAccount(EmailAddress email, String locale) {
        send(
                email,
                locale,
                "email change attempt notice",
                composer.emailChangeOnExistingAccount(localeOf(locale)));
    }

    /**
     * Sends, and swallows a refusal after saying so.
     *
     * @param what names the message in the log. The address is masked by
     *     {@link EmailAddress#toString}, so this is the only thing that distinguishes one
     *     failure from another when somebody is reading the log during an outage
     */
    private void send(EmailAddress recipient, String locale, String what, TransactionalMail mail) {
        try {
            // No name: this module holds an address and no profile. See AuthEmailComposer
            // for why it does not go and find one.
            mailer.send(recipient.value(), null, mail, localeOf(locale));
            log.info("Sent {} to {} ({}).", what, recipient, locale);
        } catch (TransactionalMailFailedException refused) {
            log.error(
                    "Could not send {} to {} ({}). The account is unchanged and nothing will retry"
                            + " this; the person has to ask for another message (#135).",
                    what,
                    recipient,
                    locale,
                    refused);
        }
    }

    /** Local development's copy of the token, on the same terms as before. */
    private void logToken(String what, EmailAddress email, String token, String locale) {
        if (logLinks) {
            log.info("{} for {} ({}): {}", what, email, locale, token);
        }
    }

    private static Locale localeOf(String tag) {
        return ReaderLocale.of(tag);
    }
}
