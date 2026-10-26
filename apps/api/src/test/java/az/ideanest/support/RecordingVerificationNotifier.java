package az.ideanest.support;

import az.ideanest.auth.application.VerificationNotifier;
import az.ideanest.shared.EmailAddress;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * A notifier that remembers instead of sending.
 *
 * <p>The verification token exists in exactly two places: the message sent to
 * the person registering, and its hash in the database. A test that wanted to
 * verify an address by reading the row would prove only that <em>a</em> token
 * exists — not that the right one was sent to the right address. So the test
 * reads what was sent.
 */
public class RecordingVerificationNotifier implements VerificationNotifier {

    /** One sent verification link. */
    public record SentVerification(EmailAddress email, String token, String locale) {
    }

    /** One sent password reset link — §4.1's A-06. */
    public record SentPasswordReset(EmailAddress email, String token, String locale) {
    }

    /** One sent address-change link, and the address it was sent to — §4.1's A-12. */
    public record SentEmailChange(EmailAddress newEmail, String token, String locale) {
    }

    /** The notice to the address an account is leaving. Carries no token by design. */
    public record SentEmailChangeNotice(EmailAddress previousEmail, EmailAddress newEmail, String locale) {
    }

    private final List<SentVerification> verifications = new CopyOnWriteArrayList<>();
    private final List<EmailAddress> existingAccountWarnings = new CopyOnWriteArrayList<>();
    private final List<SentPasswordReset> passwordResets = new CopyOnWriteArrayList<>();
    private final List<EmailAddress> passwordChangeNotices = new CopyOnWriteArrayList<>();
    private final List<SentEmailChange> emailChanges = new CopyOnWriteArrayList<>();
    private final List<SentEmailChangeNotice> emailChangeNotices = new CopyOnWriteArrayList<>();
    private final List<EmailAddress> emailChangeAttempts = new CopyOnWriteArrayList<>();

    @Override
    public void sendEmailVerification(EmailAddress email, String token, String locale) {
        verifications.add(new SentVerification(email, token, locale));
    }

    @Override
    public void sendRegistrationAttemptOnExistingAccount(EmailAddress email, String locale) {
        existingAccountWarnings.add(email);
    }

    @Override
    public void sendPasswordReset(EmailAddress email, String token, String locale) {
        passwordResets.add(new SentPasswordReset(email, token, locale));
    }

    @Override
    public void sendPasswordChanged(EmailAddress email, String locale) {
        passwordChangeNotices.add(email);
    }

    @Override
    public void sendEmailChangeConfirmation(EmailAddress newEmail, String token, String locale) {
        emailChanges.add(new SentEmailChange(newEmail, token, locale));
    }

    @Override
    public void sendEmailChangeNotice(EmailAddress previousEmail, EmailAddress newEmail, String locale) {
        emailChangeNotices.add(new SentEmailChangeNotice(previousEmail, newEmail, locale));
    }

    @Override
    public void sendEmailChangeAttemptOnExistingAccount(EmailAddress email, String locale) {
        emailChangeAttempts.add(email);
    }

    /** The most recent token sent to an address, if any. */
    public Optional<String> tokenSentTo(EmailAddress email) {
        return verifications.stream()
                .filter(sent -> sent.email().equals(email))
                .map(SentVerification::token)
                .reduce((first, second) -> second);
    }

    public long verificationsSentTo(EmailAddress email) {
        return verifications.stream().filter(sent -> sent.email().equals(email)).count();
    }

    public long warningsSentTo(EmailAddress email) {
        return existingAccountWarnings.stream().filter(email::equals).count();
    }

    /** The most recent reset token sent to an address, if any. */
    public Optional<String> resetTokenSentTo(EmailAddress email) {
        return passwordResets.stream()
                .filter(sent -> sent.email().equals(email))
                .map(SentPasswordReset::token)
                .reduce((first, second) -> second);
    }

    public long resetsSentTo(EmailAddress email) {
        return passwordResets.stream().filter(sent -> sent.email().equals(email)).count();
    }

    public long passwordChangeNoticesSentTo(EmailAddress email) {
        return passwordChangeNotices.stream().filter(email::equals).count();
    }

    /** The most recent address-change token sent to a prospective address, if any. */
    public Optional<String> emailChangeTokenSentTo(EmailAddress newEmail) {
        return emailChanges.stream()
                .filter(sent -> sent.newEmail().equals(newEmail))
                .map(SentEmailChange::token)
                .reduce((first, second) -> second);
    }

    public long emailChangeNoticesSentTo(EmailAddress previousEmail) {
        return emailChangeNotices.stream()
                .filter(sent -> sent.previousEmail().equals(previousEmail))
                .count();
    }

    /** Notices that somebody tried to move another account onto this address (#587). */
    public long emailChangeAttemptsSentTo(EmailAddress email) {
        return emailChangeAttempts.stream().filter(email::equals).count();
    }

    public void clear() {
        emailChangeAttempts.clear();
        verifications.clear();
        existingAccountWarnings.clear();
        passwordResets.clear();
        passwordChangeNotices.clear();
        emailChanges.clear();
        emailChangeNotices.clear();
    }
}
