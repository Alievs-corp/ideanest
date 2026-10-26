package az.ideanest.shared.access;

import java.util.UUID;

/**
 * Whether an account is signed in anywhere, asked from outside the module that knows.
 *
 * <p>The auth module owns sessions and already depends on the notification module, which is
 * the one that asks (#587: a push token held by one account may not be taken over by another
 * while the first is still signed in). A port here, implemented by the auth module, is how
 * {@link PlatformStaff} lets modules ask about staff without a dependency cycle, and it is the
 * same arrangement for the same reason.
 */
public interface SignedInAccounts {

    /** Whether this account holds a session that is neither revoked nor expired. */
    boolean hasLiveSession(UUID accountId);
}
