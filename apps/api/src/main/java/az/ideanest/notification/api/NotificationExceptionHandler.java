package az.ideanest.notification.api;

import az.ideanest.notification.application.DeliveryModeUnavailableException;
import az.ideanest.notification.application.InboxQueryInvalidException;
import az.ideanest.notification.application.NotificationNotFoundException;
import az.ideanest.notification.application.PreferenceContendedException;
import az.ideanest.notification.application.PreferenceNotChangeableException;
import az.ideanest.notification.application.DeviceTokenHeldException;
import az.ideanest.notification.application.UnknownDevicePlatformException;
import az.ideanest.notification.application.UnusableDeviceTokenException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What the notification endpoints refuse, as RFC 9457 problem details (§10.4).
 *
 * <p>Scoped to these two controllers rather than declared globally, exactly as
 * {@code CommentExceptionHandler} is scoped to its own: a global advice for a refusal only
 * these endpoints can raise is one that has to be read to rule out, and the drift shows up
 * as the same failure answering differently depending on which endpoint produced it.
 */
@RestControllerAdvice(
        assignableTypes = {
            DeviceController.class,
            NotificationInboxController.class,
            NotificationPreferenceController.class
        })
public class NotificationExceptionHandler {

    /**
     * 404 for a notification that does not exist and for one that belongs to somebody else.
     *
     * <p><strong>Deliberately the same answer.</strong> A notification's existence is a fact
     * about the person it was sent to — §17.4 — so an endpoint that told the two apart would
     * let anybody holding a token confirm that a given identifier is somebody's
     * notification. {@code NotificationRepository.findByIdAndRecipientId} puts the recipient
     * in the query for the same reason, so the distinction is not available here even by
     * accident.
     *
     * <p>It also answers for an email or push row, which cannot be read at all —
     * {@code notifications_only_the_inbox_is_read}. Distinguishing that would confirm what
     * channel a notification went out on.
     */
    @ExceptionHandler(NotificationNotFoundException.class)
    public ProblemDetail handleNotificationNotFound(NotificationNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/notification-not-found"));
        problem.setTitle("No such notification");
        problem.setDetail("That notification does not exist.");
        problem.setProperty("code", "NOTIFICATION_NOT_FOUND");
        return problem;
    }

    /**
     * 400 for an inbox that was asked for in a way it cannot be read.
     *
     * <p>Names the parameter, so the message can sit beside the request that produced it,
     * and carries the bound in {@code meta} so the fix does not require reading the
     * configuration. {@code CommentContentInvalidException} answers in the same shape.
     */
    @ExceptionHandler(InboxQueryInvalidException.class)
    public ProblemDetail handleInboxQueryInvalid(InboxQueryInvalidException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/inbox-query-invalid"));
        problem.setTitle("Invalid inbox request");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INBOX_QUERY_INVALID");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("field", exception.field());
        meta.putAll(exception.meta());
        problem.setProperty("meta", Map.copyOf(meta));
        return problem;
    }

    /**
     * 422 for a preference on a category that cannot have one.
     *
     * <p><strong>422 rather than 400.</strong> The request is well formed and every field in
     * it is a valid value; what is wrong is that the category is not the caller's to change
     * — the distinction {@code Unprocessable Content} exists for, and the one
     * {@code ReplyDepthExceededException} already makes one module over.
     *
     * <p><strong>Not 403.</strong> Nobody has this permission, including platform staff:
     * {@code NotificationCategory.SECURITY} cannot be silenced by anyone, so a status that
     * means "not you" would suggest there is somebody it would work for.
     *
     * <p>The category travels in {@code meta}, so a client can disable the control rather
     * than learn the rule by being refused — and
     * {@code NotificationPreferencesResponse.Preference#changeable} means it should never
     * have offered one in the first place.
     */
    @ExceptionHandler(PreferenceNotChangeableException.class)
    public ProblemDetail handleNotChangeable(PreferenceNotChangeableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/preference-not-changeable"));
        problem.setTitle("That preference cannot be changed");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "PREFERENCE_NOT_CHANGEABLE");
        problem.setProperty("meta", Map.of("category", exception.category().name()));
        return problem;
    }

    /**
     * 422 for a delivery mode the channel does not have.
     *
     * <p>422 for the reason above: the mode is a valid value and the channel is a valid
     * channel, and it is the pair that is not offered. The pair travels in {@code meta},
     * and {@code NotificationPreferencesResponse.Preference#digestOffered} is on every row
     * so a client builds the control from the response instead of hard-coding §4.10's rules.
     */
    @ExceptionHandler(DeliveryModeUnavailableException.class)
    public ProblemDetail handleModeUnavailable(DeliveryModeUnavailableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/delivery-mode-unavailable"));
        problem.setTitle("That delivery mode is not available");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "DELIVERY_MODE_UNAVAILABLE");
        problem.setProperty(
                "meta",
                Map.of("channel", exception.channel().name(), "mode", exception.mode().name()));
        return problem;
    }

    /**
     * 409 for two requests writing the same switch at the same moment.
     *
     * <p>Retriable, and that is the whole reason it is not a 500:
     * {@code PreferenceContendedException} argues it — the caller's request was valid,
     * nothing is broken, and repeating it succeeds because the second attempt finds the row
     * the first one wrote.
     */
    @ExceptionHandler(PreferenceContendedException.class)
    public ProblemDetail handleContended(PreferenceContendedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/preference-contended"));
        problem.setTitle("Those preferences were being changed");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "PREFERENCE_CONTENDED");
        return problem;
    }

    /**
     * 400 for a push token this service could not send to — issue #87.
     *
     * <p><strong>The value is not echoed.</strong> A problem detail is a document a client
     * may log and a support agent may paste, and the value in question is an address
     * somebody can send notifications to. The field is named instead, which is what a
     * client needs to fix it.
     *
     * <p>Refused rather than stored because Expo rejects an entire batch containing one
     * malformed token: a single bad registration would stop everybody else in that batch
     * being told anything.
     */
    @ExceptionHandler(UnusableDeviceTokenException.class)
    public ProblemDetail handleUnusableDeviceToken(UnusableDeviceTokenException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/unusable-device-token"));
        problem.setTitle("That is not a push token");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "UNUSABLE_DEVICE_TOKEN");
        problem.setProperty("field", "token");
        return problem;
    }

    /**
     * 409 for a push token another account holds and is still signed in to (#587).
     *
     * <p>Names neither the token nor the account, for the reason above. A client registering
     * a phone it was just handed can only wait for the first person to sign out.
     */
    @ExceptionHandler(DeviceTokenHeldException.class)
    public ProblemDetail handleDeviceTokenHeld(DeviceTokenHeldException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/device-token-held"));
        problem.setTitle("Registered to somebody else");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "DEVICE_TOKEN_HELD");
        problem.setProperty("field", "token");
        return problem;
    }

    /**
     * 400 for a platform this build does not record — issue #87.
     *
     * <p>Carries the set it does record, so that a client author can see what changed
     * without reading this service's source. A registration naming something else is
     * usually a client deployed ahead of the service rather than an attack, and the
     * difference between a 400 that names the values and one that does not is an
     * afternoon.
     */
    @ExceptionHandler(UnknownDevicePlatformException.class)
    public ProblemDetail handleUnknownDevicePlatform(UnknownDevicePlatformException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/unknown-device-platform"));
        problem.setTitle("Unknown platform");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "UNKNOWN_DEVICE_PLATFORM");
        problem.setProperty("field", "platform");
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("platforms", java.util.List.of("ios", "android"));
        problem.setProperty("meta", meta);
        return problem;
    }
}
