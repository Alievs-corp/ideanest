package az.ideanest.auth.application;

import az.ideanest.auth.infrastructure.SessionRepository;
import az.ideanest.shared.access.SignedInAccounts;
import java.time.Clock;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link SignedInAccounts}, answered from {@code sessions}.
 *
 * <p>"Live" is what the device list means by it — not revoked and not expired — so an account
 * the user would see signed in on {@code /account/security} is the account this says is signed
 * in, and nothing else.
 */
@Service
public class LiveSessions implements SignedInAccounts {

    private final SessionRepository sessions;
    private final Clock clock;

    public LiveSessions(SessionRepository sessions, Clock clock) {
        this.sessions = sessions;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public boolean hasLiveSession(UUID accountId) {
        return accountId != null && sessions.existsLiveByUser(accountId, clock.instant());
    }
}
