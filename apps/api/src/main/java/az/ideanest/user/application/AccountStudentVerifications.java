package az.ideanest.user.application;

import java.util.UUID;

/**
 * What this module needs from whoever keeps an account's student verifications, when the account
 * is anonymised — #655.
 *
 * <p>A student verification is an institution, a card number and, until a decision, a photograph
 * of the card and of the person's face. {@code student_verifications.account_id} cascades on
 * delete, and that cascade never fires: {@code users} rows are anonymised, not deleted. So the
 * anonymiser asks, as it does for {@link AccountNotifications}.
 *
 * <p><strong>An interface here, implemented over there</strong>: the verification module depends
 * on this one for account names, so the dependency cannot run the other way.
 */
public interface AccountStudentVerifications {

    /**
     * Deletes every student verification the account submitted, and every photograph behind them.
     *
     * <p>Runs inside the anonymiser's transaction. Idempotent: a second call finds nothing.
     *
     * @return how many submissions went
     */
    int forgetAll(UUID userId);
}
