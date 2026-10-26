package az.ideanest.notification.api;

import az.ideanest.notification.NotificationProperties;
import az.ideanest.notification.application.PushDevices;
import az.ideanest.notification.application.UnknownDevicePlatformException;
import az.ideanest.notification.domain.DevicePlatform;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.shared.ratelimit.RateLimits;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Where a phone says it exists, and where it says it has gone — issue #87.
 *
 * <h2>Two endpoints, and why the second one is not a {@code DELETE} by id</h2>
 *
 * <p>Sign-out is the moment a registration must be forgotten, and at that moment the
 * client holds the token and no longer holds a usable session for very long. Addressing
 * the row by token means the call can be made with the credentials that are about to be
 * discarded, and it means a client that has lost track of the identifier can still clean
 * up after itself.
 *
 * <p>The token is in the body of a {@code DELETE} rather than in the path, because a path
 * segment is the one part of a request that ends up in every access log on the way — and
 * a push token is an address somebody can send to.
 *
 * <h2>Both are idempotent, and neither takes an {@code Idempotency-Key}</h2>
 *
 * <p>§10.3's header exists for writes that would otherwise happen twice. Registering the
 * same token twice is the same upsert, and forgetting a token that is already forgotten
 * answers 204 — so there is nothing for a key to collapse. Registration is called on
 * every cold start, which is what keeps {@code last_seen_at} meaningful, so a header
 * would be paid on every launch for nothing.
 *
 * <h2>Rate limiting</h2>
 *
 * <p>Per account rather than per address, following {@code NotificationPreferenceController}:
 * the request carries a token, so limiting by address would punish everybody behind one
 * NAT and constrain nobody holding a credential. The budget is generous — a phone that
 * loses its permission and regains it can legitimately register several times in a row —
 * and what matters is that a client stuck in a loop cannot write unboundedly.
 */
@RestController
public class DeviceController {

    private final PushDevices devices;
    private final RateLimiter rateLimiter;
    private final NotificationProperties properties;

    public DeviceController(PushDevices devices, RateLimiter rateLimiter, NotificationProperties properties) {
        this.devices = devices;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    /**
     * Registers this installation for push.
     *
     * <p>409 when the token is registered to another account that is still signed in — see
     * {@code PushDevices} (#587).
     *
     * <p>201 on the first registration of a token and 200 on every later one. The
     * difference is worth carrying: a client that expected to be re-registering and is
     * told a row was created has a token it did not have before, which is the signal that
     * the installation was replaced rather than reopened.
     */
    @PostMapping("/v1/me/devices")
    public ResponseEntity<DeviceResponse> register(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody RegisterDeviceRequest request) {

        UUID userId = callerOf(accessToken);
        spendBudget(userId);

        DevicePlatform platform = DevicePlatform.parse(request.platform())
                // A platform this build does not know is a client newer than this service.
                // Refused rather than defaulted: see DevicePlatform.parse.
                .orElseThrow(UnknownDevicePlatformException::new);

        boolean existed = wasRegistered(request.token());
        DeviceResponse response = DeviceResponse.of(
                devices.register(userId, request.token(), platform, request.deviceName(), request.appVersion()));

        return existed ? ResponseEntity.ok(response) : ResponseEntity.status(201).body(response);
    }

    /**
     * Forgets this installation — sign-out, or the notification permission being revoked.
     *
     * <p>204 whether or not there was a row. A client retrying a sign-out must not be told
     * that it failed, and telling it apart would confirm to whoever holds a token that the
     * token is registered.
     *
     * <p><strong>Only the caller's own registration</strong> (#587). This used to delete by
     * token alone, on the argument that whoever holds the phone may make it stop receiving.
     * Holding a token is not holding the phone — a token can be read off a borrowed device
     * or out of a log — and a sign-out that could remove anybody's registration let one
     * account switch another's notifications off. Somebody signing out of a phone that is
     * registered to somebody else has nothing of theirs to forget, and is answered 204 like
     * everybody else.
     */
    @DeleteMapping("/v1/me/devices")
    public ResponseEntity<Void> forget(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody RegisterDeviceRequest request) {

        UUID userId = callerOf(accessToken);
        spendBudget(userId);
        devices.forget(userId, request.token());
        return ResponseEntity.noContent().build();
    }

    /** Whether this token already had a row, asked before the upsert rewrites it. */
    private boolean wasRegistered(String token) {
        return token != null && devices.isRegistered(token.trim());
    }

    private void spendBudget(UUID userId) {
        NotificationProperties.RateLimit limits = properties.rateLimit();
        RateLimits.enforce(rateLimiter.recordAttempt(
                "push-devices:account:" + userId, limits.deviceRegistrationsPerUser(), limits.window()));
    }

    /**
     * The account making the request, as our own signature establishes it.
     *
     * <p>Not read from anything the caller could choose. It is the whole of the
     * authorisation on the registration: it decides whose notifications this phone will
     * receive.
     */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
