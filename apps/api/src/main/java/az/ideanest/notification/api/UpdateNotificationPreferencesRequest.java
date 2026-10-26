package az.ideanest.notification.api;

import az.ideanest.notification.application.PreferenceChange;
import az.ideanest.notification.domain.DeliveryMode;
import az.ideanest.notification.domain.NotificationCategory;
import az.ideanest.notification.domain.NotificationChannel;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * {@code PATCH /v1/me/notification-preferences}.
 *
 * <p><strong>A list of switches rather than a whole page, which is the point of the
 * {@code PATCH}.</strong> {@code PreferenceChange} argues it: a settings page sends what
 * somebody touched, and a {@code PUT} would mean any request that omitted a switch silently
 * reset it — which on a page open in two tabs is one tab quietly undoing the other.
 *
 * <p><strong>These three fields carry bean-validation annotations, unlike most bodies in
 * this service.</strong> {@code PostCommentRequest} deliberately has none, because the rule
 * about what a comment may say lives in a value object the entity calls on the way in.
 * There is no equivalent here: the three fields are enums, so the only thing that can be
 * wrong with a well-formed request is that one of them is absent, and the alternative to
 * annotating it is {@code PreferenceChange}'s constructor raising a
 * {@code NullPointerException} — a 500 for what is plainly the caller's mistake. An
 * unrecognised enum value never reaches here at all: Jackson refuses the body and §10.4's
 * handler answers 400.
 *
 * <p>There is no account in the body. Whose preferences these are is the access token, and
 * a {@code userId} field would be the one field that decides it.
 *
 * @param preferences the switches to set. Empty is accepted and changes nothing, which
 *     makes this endpoint a read as well — {@code NotificationPreferences.apply} answers
 *     with the whole page either way, so a client with nothing to change does not need a
 *     second route
 */
public record UpdateNotificationPreferencesRequest(
        @NotNull(message = "A request carries some list of preferences, possibly empty")
                @Size(max = 500) List<@Valid @NotNull Change> preferences) {

    /**
     * One switch being set.
     *
     * @param category which group of §4.10's rows
     * @param channel which of §4.10's three columns
     * @param mode what to do about it
     */
    public record Change(
            @NotNull(message = "A preference names a category") NotificationCategory category,
            @NotNull(message = "A preference names a channel") NotificationChannel channel,
            @NotNull(message = "A preference says what to do") DeliveryMode mode) {

        PreferenceChange toChange() {
            return new PreferenceChange(category, channel, mode);
        }
    }

    /** The instructions, as the application layer's own type. */
    public List<PreferenceChange> changes() {
        return preferences.stream().map(Change::toChange).toList();
    }
}
