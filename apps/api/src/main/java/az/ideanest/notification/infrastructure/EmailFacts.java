package az.ideanest.notification.infrastructure;

/**
 * The six things any email copy in {@code messages.properties} may refer to.
 *
 * <p><strong>One argument vector for every type, rather than a bespoke one each.</strong>
 * {@code MessageFormat} is positional, so a per-type vector would mean twenty
 * independent conventions about what {@code {0}} means and twenty chances for a template
 * and its caller to disagree silently — the failure mode being an email that says
 * "your pledge to 25.00 AZN". Fixing the positions once, and naming them here, makes a
 * key's arguments something a translator can read off this record.
 *
 * <p>A slot a type has nothing for is the empty string rather than null, so that a key
 * which mentions it renders a gap instead of the word {@code null}. Keys are written not
 * to mention slots their type does not fill; {@code EmailCopyTests} holds that.
 *
 * @param recipientName {@code {0}} — who is being written to, by the name on their
 *     account
 * @param projectTitle {@code {1}} — the campaign this is about, as it was called when the
 *     event happened.
 *     <p><strong>Filled since #249</strong>, from {@code notifications.params}, which
 *     {@code NotificationEventListener} now populates through
 *     {@code shared.project.ProjectSummaries} — the port that lets the notification module
 *     ask the project module for a name without reading {@code projects}.
 *     <p><strong>Still empty on three kinds of row, and the copy has to survive it.</strong>
 *     A notification written before #249 has no title in its document; neither has one
 *     whose campaign was deleted between the event and the send; and neither has a message
 *     that is not about a campaign at all. That is why a key naming the campaign is a
 *     {@code .named} twin rather than a rewritten key — {@code EmailComposer} chooses
 *     between them on whether this slot is empty
 * @param amount {@code {2}} — the money the message is about, already formatted for
 *     reading. A string, because §10.3's rule does not stop at the API boundary: an
 *     amount that became a double to be rendered is an amount that may render wrongly
 * @param detail {@code {3}} — the one further fact the type needs, if it needs one: which
 *     retry a payment failure was, how many people backed a campaign
 * @param account {@code {4}} — the masked account money went to ({@code AZ21…1944}), never the
 *     number — #418. Often absent, so only a type's {@code .account} paragraph names it, and
 *     {@code EmailComposer} leaves that paragraph out when this is empty
 * @param plan {@code {5}} — the creator plan a subscription message is about ({@code Growth}) — #450.
 *     Its own slot rather than {@code {1}}: the plan is not a campaign, and putting it there would
 *     make every {@code .named} key, and the inbox's campaign link, read a plan as one
 */
public record EmailFacts(
        String recipientName, String projectTitle, String amount, String detail, String account, String plan) {

    /** What a type with nothing to add says: the recipient's name and nothing else. */
    public static EmailFacts of(String recipientName) {
        return new EmailFacts(recipientName, "", "", "", "", "");
    }

    public EmailFacts {
        recipientName = recipientName == null ? "" : recipientName;
        projectTitle = projectTitle == null ? "" : projectTitle;
        amount = amount == null ? "" : amount;
        detail = detail == null ? "" : detail;
        account = account == null ? "" : account;
        plan = plan == null ? "" : plan;
    }

    /** The same, with the campaign named. */
    public EmailFacts about(String title) {
        return new EmailFacts(recipientName, title, amount, detail, account, plan);
    }

    /** The same, carrying an amount. */
    public EmailFacts withAmount(String formatted) {
        return new EmailFacts(recipientName, projectTitle, formatted, detail, account, plan);
    }

    /** The same, carrying the type's one further fact. */
    public EmailFacts withDetail(String value) {
        return new EmailFacts(recipientName, projectTitle, amount, value, account, plan);
    }

    /** The same, carrying the masked account. */
    public EmailFacts withAccount(String hint) {
        return new EmailFacts(recipientName, projectTitle, amount, detail, hint, plan);
    }

    /** The same, naming the creator plan. */
    public EmailFacts withPlan(String name) {
        return new EmailFacts(recipientName, projectTitle, amount, detail, account, name);
    }

    /** The vector, in the order the keys document. */
    public Object[] arguments() {
        return new Object[] {recipientName, projectTitle, amount, detail, account, plan};
    }
}
