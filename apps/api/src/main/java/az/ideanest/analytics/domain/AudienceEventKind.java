package az.ideanest.analytics.domain;

/**
 * What an audience event says happened — #633.
 *
 * <p>{@link #code()} is what {@code audience_seen.kind} stores (V124): the table is
 * rewritten every day and a smallint keeps its key short.
 */
public enum AudienceEventKind {

    /** A page of the site was shown. Counts a page view every time and a visitor once a day. */
    VISIT(1),

    /** A campaign's page was opened. Counts once per visitor, campaign and day. */
    VIEW(2),

    /** A campaign's card was clicked. Counts once per visitor, campaign and day. */
    CLICK(3);

    private final short code;

    AudienceEventKind(int code) {
        this.code = (short) code;
    }

    public short code() {
        return code;
    }

    /** Whether the event is about one campaign, and so must name it. */
    public boolean isAboutACampaign() {
        return this != VISIT;
    }
}
