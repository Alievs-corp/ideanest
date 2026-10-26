package az.ideanest.notification.infrastructure;

import az.ideanest.notification.domain.PushDevice;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/**
 * Registered installations, by the four questions asked of them — issue #87.
 *
 * <p>There is deliberately no "every device on the platform" read. The only queries are
 * about one recipient, one token, or one age; a method that could enumerate the table
 * would be the beginning of a report about who has the application installed, which
 * §17.4 has no purpose for.
 */
public interface PushDeviceRepository extends JpaRepository<PushDevice, UUID> {

    /**
     * Every installation to send this person's notification to.
     *
     * <p>Usually one, sometimes two — a phone and a tablet — and occasionally zero, which
     * is the case that matters: an account with the application uninstalled has no rows,
     * and {@code PushChannelSender} has to treat that as "nothing to do" rather than as a
     * failure to retry.
     */
    List<PushDevice> findByUserId(UUID userId);

    /** The one row a registration replaces, if the installation has registered before. */
    Optional<PushDevice> findByToken(String token);

    /**
     * Forgets one installation.
     *
     * <p>Returns the number of rows removed so that a caller can tell "signed out" from
     * "signed out twice"; the endpoint answers 204 either way, because a client retrying a
     * sign-out must not be told it failed.
     */
    long deleteByToken(String token);

    /**
     * Forgets one installation, if it is registered to this account (#587).
     *
     * <p>What sign-out calls. {@link #deleteByToken} stays for the push service's own
     * {@code DeviceNotRegistered}, which is about the token and nobody's request.
     */
    long deleteByTokenAndUserId(String token, UUID userId);

    /**
     * The retention sweep — §17.4.
     *
     * <p>A registration nobody has refreshed is an address nobody has confirmed. Deleting
     * rather than flagging, because there is nothing a flagged row could be used for: the
     * next time the application opens it registers again, and the token it registers with
     * is the current one rather than the one that went stale.
     */
    @Modifying
    @Query("delete from PushDevice device where device.lastSeenAt < :before")
    int deleteLastSeenBefore(Instant before);
}
