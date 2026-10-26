package az.ideanest.notification.application;

import az.ideanest.notification.domain.DevicePlatform;
import az.ideanest.notification.domain.PushDevice;
import az.ideanest.notification.infrastructure.PushDeviceRepository;
import az.ideanest.shared.access.SignedInAccounts;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Which phones to send to — issue #87's registry.
 *
 * <h2>Registration is an upsert on the token, and the account is what it rewrites</h2>
 *
 * <p>Two people can sign into one phone. Were both registrations kept, the second
 * person's pledge confirmation would arrive on a device the first person is holding, and
 * a notification is not a small disclosure — §4.10's push copy names amounts and campaign
 * titles. So a token belongs to whoever signed in most recently and to nobody else, which
 * the unique index on {@code token} is what makes expressible.
 *
 * <p><strong>A token moves only from an account that has signed out everywhere</strong>
 * (#587). Moving it whenever asked meant anybody who had once read a token — off a phone they
 * borrowed, or out of a log — could take another person's notifications away by registering
 * it to themselves, and could stop them with a sign-out call for a token that was never
 * theirs. Signing out on the phone forgets the registration ({@link #forget}), so the
 * ordinary second person on a phone finds no row to take over; a row that is still there
 * belongs to somebody who did not sign out, and while they hold a live session anywhere
 * {@link #register} refuses. It is the account rather than the session on that phone that is
 * asked, because a registration does not record which session made it: the cost is that a
 * phone whose first user's sign-out never reached the service stays theirs until their other
 * sessions end, which errs towards the person whose notifications they are.
 *
 * <p>The reverse — one person, several phones — is a real case and is supported: the
 * tokens differ, so the rows differ, and a send goes to all of them.
 *
 * <h2>The token is validated here as well as in the schema</h2>
 *
 * <p>Expo refuses a whole batch containing one malformed token. A single bad row would
 * therefore stop everybody else in that batch being told anything, so the shape is
 * checked at the two points a bad one can enter: {@code push_devices_token_shape} and
 * {@link #REGISTERED_TOKEN}. That is not belt and braces — one of them is a client
 * mistake caught with a 400, and the other is anything that reaches the table another way.
 */
@Service
public class PushDevices {

    private static final Logger log = LoggerFactory.getLogger(PushDevices.class);

    /**
     * What Expo issues. Both spellings, because the service has emitted
     * {@code ExponentPushToken[...]} since the beginning and {@code ExpoPushToken[...]}
     * since SDK 46, and both are still valid addresses.
     */
    public static final Pattern REGISTERED_TOKEN =
            Pattern.compile("^Expo(nent)?PushToken\\[[A-Za-z0-9_-]{1,128}]$");

    /** Free text from a client is bounded so that it cannot be used as storage. */
    private static final int MAX_DEVICE_NAME = 120;

    private static final int MAX_APP_VERSION = 40;

    private final PushDeviceRepository devices;
    private final SignedInAccounts signedIn;
    private final Clock clock;

    public PushDevices(PushDeviceRepository devices, SignedInAccounts signedIn, Clock clock) {
        this.devices = devices;
        this.signedIn = signedIn;
        this.clock = clock;
    }

    /**
     * Registers, or re-registers, one installation.
     *
     * <p>Idempotent by construction rather than by an {@code Idempotency-Key}: the second
     * call with the same token is the same upsert, and §10.3's header exists for writes
     * that would otherwise happen twice. It is called on every cold start of the
     * application, which is what keeps {@code last_seen_at} meaningful.
     *
     * @throws UnusableDeviceTokenException when the token is not one Expo could have
     *     issued. See the class comment for why this is refused rather than stored
     * @throws DeviceTokenHeldException when another account holds the token and is still
     *     signed in somewhere. See the class comment
     */
    @Transactional
    public PushDevice register(
            UUID userId, String token, DevicePlatform platform, String deviceName, String appVersion) {
        String address = token == null ? "" : token.trim();
        if (!REGISTERED_TOKEN.matcher(address).matches()) {
            throw new UnusableDeviceTokenException();
        }

        Instant now = clock.instant();
        String name = truncated(deviceName, MAX_DEVICE_NAME);
        String version = truncated(appVersion, MAX_APP_VERSION);

        Optional<PushDevice> existing = devices.findByToken(address);
        if (existing.isPresent()) {
            PushDevice device = existing.get();
            /*
             * Logged when the owner changes and not otherwise, because that is the case
             * worth being able to reconstruct: a person reporting that they received
             * somebody else's notification is asking about exactly this moment. No token
             * and no account in the line -- the row identifier is enough to find both,
             * and neither belongs in a log stream (§17.4).
             */
            if (!device.getUserId().equals(userId)) {
                if (signedIn.hasLiveSession(device.getUserId())) {
                    log.info("Push registration {} kept: its account is still signed in.", device.getId());
                    throw new DeviceTokenHeldException();
                }
                log.info("Push registration {} moved to a different account.", device.getId());
            }
            device.seen(userId, platform, name, version, now);
            return device;
        }

        return devices.save(PushDevice.register(userId, address, platform, name, version, now));
    }

    /**
     * Whether this token already has a row.
     *
     * <p>Asked by {@code DeviceController} before the upsert, so that a first registration
     * can answer 201 and a refresh 200. It is deliberately not folded into
     * {@link #register}: a method that answered "and by the way it was new" would be a
     * second return value nobody but the controller wants.
     */
    @Transactional(readOnly = true)
    public boolean isRegistered(String token) {
        return token != null && !token.isBlank() && devices.findByToken(token.trim()).isPresent();
    }

    /**
     * Forgets one installation — sign-out, and the notification permission being revoked.
     *
     * <p>Deleting rather than marking revoked: there is nothing a kept row could be used
     * for. The next sign-in registers again, with whatever token is current then, and a
     * token that has been sitting unused is more likely to be stale than the fresh one.
     *
     * <p><strong>Only this account's registration.</strong> It deleted by token alone, so
     * anybody holding a token could stop another person's notifications (#587). Somebody
     * signing out of a phone registered to somebody else has nothing of theirs to forget.
     */
    @Transactional
    public void forget(UUID userId, String token) {
        if (token == null || token.isBlank()) {
            return;
        }
        devices.deleteByTokenAndUserId(token.trim(), userId);
    }

    /**
     * Everywhere to send this person's notification.
     *
     * <p>Empty is an ordinary answer and not a failure: most accounts on this platform
     * have never installed the application. {@code PushChannelSender} treats it as
     * nothing to do, which is why a push preference on an account with no phone does not
     * fill the dead-letter index.
     */
    @Transactional(readOnly = true)
    public List<PushDevice> reachable(UUID userId) {
        return devices.findByUserId(userId);
    }

    /**
     * Drops a token the push service says is gone — Expo's {@code DeviceNotRegistered}.
     *
     * <p>This is the only signal an uninstall ever produces. Acting on it is what stops
     * the platform sending to a phone that has not had the application on it for a year,
     * and it is why {@code PushChannelSender} reads the per-token receipts rather than
     * only the batch's status.
     */
    @Transactional
    public void unregistered(String token) {
        long removed = devices.deleteByToken(token);
        if (removed > 0) {
            log.info("Dropped a push registration the service reported as no longer registered.");
        }
    }

    /**
     * §17.4's minimisation, applied to addresses — the retention half of #87.
     *
     * @param maxAge how long a registration may go unrefreshed. The application
     *     re-registers on every cold start, so anything approaching this is a phone that
     *     has not opened it in that time
     * @return how many were forgotten
     */
    @Transactional
    public int forgetUnusedSince(Duration maxAge) {
        int removed = devices.deleteLastSeenBefore(clock.instant().minus(maxAge));
        if (removed > 0) {
            log.info("Forgot {} push registrations unused for longer than {}.", removed, maxAge);
        }
        return removed;
    }

    /**
     * Trimmed and cut, never refused.
     *
     * <p>Both fields are diagnostics — what the phone calls itself, which build it is —
     * and a registration refused because somebody's phone has a long name is a phone that
     * receives nothing. The bound exists so the column cannot be used as storage, and the
     * database carries the same one.
     */
    private static String truncated(String value, int max) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }
}
