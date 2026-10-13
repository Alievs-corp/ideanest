package az.ideanest.notification.domain;

/**
 * What a preference is expressed about.
 *
 * <p>§4.10 lists twenty-two kinds of notification and then says, in one line, that
 * "preferences are per category and per channel". This is that grouping, and it is a
 * usability decision rather than a storage one: twenty-two switches times three
 * channels is a settings page nobody finishes reading, and the rows that belong
 * together — "payment collected", "payment failed", "final payment warning" — are
 * exactly the ones somebody wants to answer once.
 *
 * <p>The cost is stated rather than hidden: a backer who wants the confirmation but
 * not the survey reminder cannot express that, because both are the campaign they
 * backed. Splitting a category later is possible and is a migration plus a decision
 * about what everybody's existing instruction means for the two halves — which is why
 * {@code notifications.category} is stored on the row rather than derived at read
 * time.
 */
public enum NotificationCategory {

    /** A backer's own pledges: confirmed, edited. */
    PLEDGES(false),

    /** A campaign's life: goal reached, deadlines, the outcome, approval. */
    CAMPAIGN(false),

    /** Money moving: collection, failure, the final warning, a payout, and since #450 a creator's own plan. */
    PAYMENTS(false),

    /** People talking: updates, comment replies, direct messages. */
    COMMUNITY(false),

    /** After the campaign: surveys and shipping. */
    REWARDS(false),

    /** Things somebody asked to be told about: follows, saves, launch reminders. */
    DISCOVERY(false),

    /**
     * Account security. §4.10's "sign-in from a new device", and whatever joins it.
     *
     * <p><strong>Mandatory: this one cannot be turned off.</strong> The message exists
     * to tell somebody that another person is in their account, and the first thing
     * that other person would do is silence it. A preference that can be set by
     * whoever stole the session is not a preference the account holder has.
     *
     * <p>Enforced twice on purpose — {@code NotificationPreferences} refuses to store
     * the instruction, so the person is told rather than ignored, and
     * {@link DeliveryPolicy} ignores it if a row for it exists anyway, so a value that
     * arrived by any other route still does not silence the alert.
     */
    SECURITY(true);

    private final boolean mandatory;

    NotificationCategory(boolean mandatory) {
        this.mandatory = mandatory;
    }

    /** Whether the platform sends this whatever the recipient has asked for. */
    public boolean isMandatory() {
        return mandatory;
    }
}
