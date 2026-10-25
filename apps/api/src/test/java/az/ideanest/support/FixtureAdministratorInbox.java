package az.ideanest.support;

import az.ideanest.auth.application.AuthEvents.EmailVerificationRequested;
import az.ideanest.auth.application.EmailVerificationService;
import az.ideanest.shared.EmailAddress;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The inbox of the test profile's bootstrap administrator, which opens its verification link
 * as soon as it arrives.
 *
 * <p>#577 makes a listed address a super admin only once its account has proven it. About
 * fifty suites share {@code moderator@ideanest.test} as their administrator, each registering
 * it through the endpoint when it is missing ({@code IdentitySchemaTests} empties
 * {@code users}, so it goes missing mid-run), and none of them is about verification. Teaching
 * every one of their fixtures to redeem a link would be fifty copies of a precondition; this
 * is that precondition, once, in the place the suites already share. {@code Verifications}
 * makes the same argument for identity checks.
 *
 * <p><strong>Only that one address.</strong> {@code BootstrapAdministratorApiTests} uses a
 * second listed address that nobody verifies for it, and that suite is where the rule itself
 * is asserted. Widening this to every listed address would make that suite pass whether or
 * not the rule held.
 *
 * <p>It redeems the token registration actually sent, through the service the link's endpoint
 * calls, rather than writing {@code email_verified_at}: the account ends up in exactly the
 * state a person clicking the link leaves it in. After commit, like the notifier that sends
 * the link, and in a transaction of its own, because the one that registered the account has
 * already committed and work joined to it would never be written.
 */
public class FixtureAdministratorInbox {

    /** The address in {@code application-test.yml}'s {@code ideanest.staff.bootstrap-emails}. */
    public static final EmailAddress ADDRESS = EmailAddress.of("moderator@ideanest.test");

    private final EmailVerificationService verifications;
    private final TransactionTemplate separateTransaction;

    public FixtureAdministratorInbox(EmailVerificationService verifications, PlatformTransactionManager transactions) {
        this.verifications = verifications;
        this.separateTransaction = new TransactionTemplate(transactions);
        this.separateTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onVerificationRequested(EmailVerificationRequested event) {
        if (!ADDRESS.equals(event.email())) {
            return;
        }
        separateTransaction.executeWithoutResult(status -> verifications.verify(event.token()));
    }
}
