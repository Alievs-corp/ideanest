package az.ideanest.notification.domain;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;

/**
 * §4.10's table, as code: the twenty-two things the platform tells somebody, which
 * category each belongs to, and which channels each has.
 *
 * <p><strong>The crosses in §4.10 are not "off by default".</strong> "Pledge edited"
 * has no push and "24 hours remaining" has no email, and those are channels the type
 * does not have at all — no preference turns them on, and the fan-out never considers
 * them. That distinction is the reason the supported set lives here, on the type,
 * rather than being expressed as a default preference somewhere: a default is
 * something a person may overrule, and this is not.
 *
 * <p><strong>Most of these have no producer.</strong> The platform records almost no
 * outbox events yet — {@code PledgeConfirmed} in the analytics module says so at
 * length about the one it consumes — so the catalogue is deliberately complete while
 * {@code NotificationEventListener} translates only the handful of event types that
 * have a defined shape. A type in this enum with nothing that produces it is a row of
 * §4.10 waiting for its producer, not an oversight; a type missing from it would be a
 * notification the preference page cannot describe.
 */
public enum NotificationType {

    // §4.10, in order.

    /** A pledge went through. Email, push, in-app. */
    PLEDGE_CONFIRMED(NotificationCategory.PLEDGES, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /**
     * A backer changed their pledge. Email and in-app.
     *
     * <p>No push, per §4.10, and the reason is worth keeping: the person who made the
     * change is holding the phone the push would arrive on.
     */
    PLEDGE_EDITED(NotificationCategory.PLEDGES, NotificationChannel.EMAIL, NotificationChannel.IN_APP),

    /** The campaign hit its goal. */
    GOAL_REACHED(NotificationCategory.CAMPAIGN, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** Forty-eight hours left. */
    DEADLINE_48H(NotificationCategory.CAMPAIGN, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /**
     * Twenty-four hours left. Push and in-app only.
     *
     * <p>§4.10 gives this one no email, and it is the only deadline row that has none:
     * two mails about the same deadline a day apart is the point at which a reminder
     * becomes a nuisance, and the second one is more useful on a device than in a
     * mailbox.
     */
    DEADLINE_24H(NotificationCategory.CAMPAIGN, NotificationChannel.PUSH, NotificationChannel.IN_APP),

    /** The campaign funded. */
    CAMPAIGN_SUCCEEDED(NotificationCategory.CAMPAIGN, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** The campaign did not fund. */
    CAMPAIGN_UNSUCCESSFUL(NotificationCategory.CAMPAIGN, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /**
     * IDN-EXT-01 (#34): the creator extended the deadline once. Every backer is told the new
     * date and asked nothing — §5.1 — so it goes by every channel a funding outcome does.
     */
    CAMPAIGN_EXTENDED(NotificationCategory.CAMPAIGN, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /**
     * §5.5's monthly update is nearly due — issue #437.
     *
     * <p><strong>The only message the obligation clock sends, and it is a warning rather than a
     * verdict.</strong> #437: "the point is compliance, not catching people". A lapse notifies
     * nobody — it produces a state on the campaign page and a case in a moderator's queue —
     * because telling a creator they are late immediately after warning them is the platform
     * saying the same thing twice with a worse tone.
     *
     * <p>{@code CAMPAIGN} rather than a category of its own: §21 gives a reader one preference
     * switch per category, and a switch whose only member is a reminder a creator is obliged to
     * act on would be a switch for turning off an obligation.
     */
    UPDATE_DUE_SOON(NotificationCategory.CAMPAIGN, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** Moderation cleared the campaign for launch — §4.11's AD-01. */
    PROJECT_APPROVED(NotificationCategory.CAMPAIGN, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** The card was charged. */
    PAYMENT_COLLECTED(NotificationCategory.PAYMENTS, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** The card was refused. §4.10 puts this row in bold and it deserves it. */
    PAYMENT_FAILED(NotificationCategory.PAYMENTS, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** The last attempt before the pledge is dropped. */
    FINAL_PAYMENT_WARNING(NotificationCategory.PAYMENTS, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** The creator's money left the platform — §4.11's AD-05. */
    PAYOUT_SENT(NotificationCategory.PAYMENTS, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** IDN-EXT-01 (#41): to every backer — the creator's payout was requested; dispute until the date. */
    WITHDRAWAL_REQUESTED(NotificationCategory.PAYMENTS, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** IDN-EXT-01 (#41): to the creator, weekly — the payout waits for their VÖEN and business card. */
    PAYOUT_DETAILS_NEEDED(NotificationCategory.PAYMENTS, NotificationChannel.EMAIL, NotificationChannel.IN_APP),

    /** A campaign published an update — §5.5 and #83. */
    NEW_UPDATE_PUBLISHED(NotificationCategory.COMMUNITY, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** Somebody answered a comment. */
    COMMENT_REPLY(NotificationCategory.COMMUNITY, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** A direct message arrived. */
    DIRECT_MESSAGE(NotificationCategory.COMMUNITY, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** A reward survey is ready to fill in. */
    SURVEY_AVAILABLE(NotificationCategory.REWARDS, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** A reward survey has been ignored for too long. */
    SURVEY_OVERDUE(NotificationCategory.REWARDS, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** A reward is on its way. */
    REWARD_SHIPPED(NotificationCategory.REWARDS, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** Somebody a backer follows launched something. */
    FOLLOWED_CREATOR_LAUNCHED(NotificationCategory.DISCOVERY, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /**
     * "Reminder: project launched" — §4.4's pre-launch list, built by #39.
     *
     * <p>The one row of §4.10 with anything behind it today, and it is delivered by
     * {@code LaunchReminderNotifier} in the project module rather than from here. That
     * port's own comment says #85 replaces it; replacing it means the project module
     * recording an outbox event instead of calling a notifier, which is an edit to
     * somebody else's module and is deliberately not in this change.
     */
    LAUNCH_REMINDER(NotificationCategory.DISCOVERY, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** A campaign somebody saved is about to close. */
    SAVED_PROJECT_ENDING_SOON(NotificationCategory.DISCOVERY, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP),

    /** Somebody signed in from somewhere new — §17.1. Cannot be turned off. */
    NEW_DEVICE_SIGN_IN(NotificationCategory.SECURITY, NotificationChannel.EMAIL, NotificationChannel.PUSH,
            NotificationChannel.IN_APP);

    private final NotificationCategory category;
    private final Set<NotificationChannel> channels;

    NotificationType(NotificationCategory category, NotificationChannel... channels) {
        this.category = category;
        this.channels = Set.of(channels);
    }

    /** The group this type's preference is expressed under. */
    public NotificationCategory category() {
        return category;
    }

    /**
     * The channels this type has at all — §4.10's ticks.
     *
     * <p>The fan-out iterates this and nothing else, so a channel absent from it is
     * never considered, never stored, and never something a preference can enable.
     */
    public Set<NotificationChannel> channels() {
        return channels;
    }

    /** Whether §4.10 gives this type that column. */
    public boolean supports(NotificationChannel channel) {
        return channels.contains(channel);
    }

    /**
     * Every channel any type in this category has: the switches a settings page draws.
     *
     * <p><strong>A union rather than an intersection, and the choice matters.</strong>
     * §4.10 gives "pledge confirmed" a push column and "pledge edited" none, and both are
     * {@code PLEDGES}. An intersection would drop the push switch from that category
     * altogether, which would leave somebody unable to turn off a push notification they
     * demonstrably receive. The union means the switch exists and governs the types that
     * have the column; the ones that do not are unaffected, because the fan-out iterates
     * {@link #channels()} and never considers a channel a type does not have.
     *
     * <p>Computed rather than tabulated, so that adding a row to §4.10 cannot leave the
     * preference page describing the previous version of the table.
     *
     * @return the channels, in enum order, so that a page's rows do not depend on a hash
     */
    public static Set<NotificationChannel> channelsOf(NotificationCategory category) {
        Objects.requireNonNull(category, "A category has some channels");
        EnumSet<NotificationChannel> union = EnumSet.noneOf(NotificationChannel.class);
        for (NotificationType type : values()) {
            if (type.category == category) {
                union.addAll(type.channels);
            }
        }
        return Collections.unmodifiableSet(union);
    }
}
