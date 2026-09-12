package az.ideanest.audit;

/**
 * Every privileged action the platform records, and what each one is done to.
 *
 * <p><strong>The entity kind travels with the action rather than beside it.</strong>
 * A recording API that took {@code ("project.approved", "collaborator", id)} would
 * eventually be given exactly that, and the row would be invisible to the one query
 * anybody runs against this table — "what has happened to this campaign". Pairing
 * them here makes the mistake unspellable: a caller chooses a constant and supplies
 * an identifier, and nothing else about the row is theirs to get wrong.
 *
 * <p>A closed set in Java and open text in the column, which is deliberate and is
 * V19's argument about {@code outbox_events.event_type}. The set grows with every
 * feature that adds a privileged action, and a new one must not be a migration and
 * a deployment-ordering problem; what the enum buys is that the <em>writing</em>
 * side cannot invent a spelling, so a reader filtering on {@code project.approved}
 * is not silently missing rows that say {@code project_approved}.
 *
 * <p>The wire spelling is {@code <entity>.<past participle>}. Past tense because a
 * row is a statement about something that already happened — including when the
 * outcome is {@link AuditOutcome#REFUSED}, where what happened is the attempt.
 */
public enum AuditAction {

    /** Moderation cleared a campaign for launch. */
    PROJECT_APPROVED("project.approved", "project"),

    /** Moderation refused a campaign. Terminal for the campaign. */
    PROJECT_REJECTED("project.rejected", "project"),

    /** Moderation sent a campaign back to its creator. */
    PROJECT_CHANGES_REQUESTED("project.changes_requested", "project"),

    /**
     * An update was published to a campaign's backers (#83).
     *
     * <p>The entity is the campaign rather than the update, unlike
     * {@link #COLLABORATOR_INVITED}: an update has no later history of its own — §10.2
     * gives it no edit and no withdrawal — so a row keyed on it would be a history of
     * one, invisible to the one query anybody runs against this table. Which update is
     * in the detail, as its number.
     *
     * <p>Privileged because §5.5 makes publishing an update an obligation a funded
     * creator owes their backers, and because the statement is irreversible: everybody
     * following the campaign is told, and no endpoint takes it back.
     */
    PROJECT_UPDATE_PUBLISHED("project.update_published", "project"),

    /**
     * Somebody's comment was removed by somebody who did not write it (#84). §4.7's
     * CD-14 and AD-09.
     *
     * <p>The entity is the campaign rather than the comment, for
     * {@link #PROJECT_UPDATE_PUBLISHED}'s reason: a comment is removed once and never
     * restored, so a row keyed on it would be a history of one and invisible to the
     * question anybody actually asks — "what has this campaign's team been taking
     * down". Which comment, and whose, is in the detail.
     *
     * <p><strong>An author withdrawing their own comment is deliberately not recorded,
     * and that is the line.</strong> Deleting what you wrote is the ordinary use of a
     * button; deleting what somebody else wrote from a public page is one account
     * silencing another, is irreversible through any endpoint, and is the first thing a
     * complaint about over-moderation asks about. Recording both would bury the second
     * under the first at a ratio nobody can filter.
     */
    PROJECT_COMMENT_REMOVED("project.comment_removed", "project"),

    /**
     * Somebody was invited onto a campaign.
     *
     * <p>The entity is the grant and not the campaign, because the grant is what is
     * later widened and withdrawn, and three rows about one collaborator are only
     * a history if they share an identifier.
     */
    COLLABORATOR_INVITED("collaborator.invited", "collaborator"),

    /** A collaborator's capabilities were replaced. */
    COLLABORATOR_CAPABILITIES_CHANGED("collaborator.capabilities_changed", "collaborator"),

    /** A grant, or an invitation nobody had accepted, was withdrawn. */
    COLLABORATOR_REVOKED("collaborator.revoked", "collaborator"),

    /** An account was closed, starting §17.4's thirty-day grace period. */
    ACCOUNT_DELETION_REQUESTED("account.deletion_requested", "account"),

    /** A pending deletion was withdrawn inside the grace period. */
    ACCOUNT_DELETION_CANCELLED("account.deletion_cancelled", "account"),

    /**
     * Everything the platform holds about an account left it in one response.
     *
     * <p>Privileged despite changing nothing. §17.4's export endpoint is the single
     * most valuable request a stolen access token can make, and "when was this
     * account copied, and from where" is a question only this row can answer.
     */
    ACCOUNT_EXPORTED("account.exported", "account"),

    /**
     * A campaign's backer report left the platform as a file (#79). §4.7's CD-11.
     *
     * <p>Privileged despite changing nothing, for {@link #ACCOUNT_EXPORTED}'s reason and
     * with the subject the other way round: one request copies out the name and email
     * address of <em>every person who backed the campaign</em>. It is the most valuable
     * request a stolen collaborator token can make on the creator dashboard, and "who
     * exported this campaign's backers, when, and from where" is a question only this row
     * can answer.
     *
     * <p>The entity is the campaign rather than the export, because there is no export
     * object: §10.2 answers the route with a file rather than with a job somebody later
     * fetches. How many rows left, and under which filter, is in the detail.
     */
    PROJECT_BACKERS_EXPORTED("project.backers_exported", "project"),

    /**
     * A message was sent to a campaign's backers, or to a saved segment of them — §4.7's CD-13
     * (#98).
     *
     * <p>Audited for the reason the export above is, and for one of its own. The export's is
     * that it moves personal data out of the platform; this one's is that it puts a message
     * <em>into</em> several thousand inboxes in the campaign's name, and it cannot be taken
     * back. "Who sent this, when, to which segment, and how many people got it" is a question
     * only this row can answer once the segment has been renamed or deleted.
     *
     * <p>The entity is the campaign rather than the message, following the export: a caller
     * asking "what has happened to this campaign" should find it, and the message identifier is
     * in the detail.
     *
     * <p><strong>The detail carries the act and never the content.</strong> This table has no
     * retention rule and refuses {@code DELETE}, so a creator's prose in it is a decision nobody
     * can reverse. {@code campaign_messages} is where the text lives.
     */
    PROJECT_SEGMENT_MESSAGED("project.segment_messaged", "project"),

    /**
     * §4.8's PM-08 (#75): a creator froze their campaign's shipping addresses.
     *
     * <p>Audited although the backer's own write of an address is not, and the asymmetry is
     * the rule rather than an omission. A backer editing their own address is somebody
     * changing their own data; a lock is a privileged action taken over several thousand
     * other people's, by somebody who is not any of them, and after it they cannot correct a
     * mistake without asking. "Who stopped them, and when" is precisely what an append-only
     * table is for.
     *
     * <p>The entity is the campaign, following {@link #PROJECT_SEGMENT_MESSAGED}: the
     * question somebody asks is "what has happened to this campaign".
     *
     * <p><strong>The detail carries counts and no address.</strong> This table has no
     * retention rule and refuses {@code DELETE}, so a postal address in it would outlive
     * §17.4's erasure — which is the one thing V36's encryption cannot protect against.
     */
    PROJECT_ADDRESSES_LOCKED("project.addresses_locked", "project"),

    /**
     * §4.8's PM-04 (#74): a survey went out to a campaign's backers.
     *
     * <p>Audited for {@link #PROJECT_SEGMENT_MESSAGED}'s reason and one of its own: it is a
     * message several thousand people receive in the campaign's name and it cannot be taken
     * back, and it is the moment the survey's questions freeze. "Who sent it, when, and how
     * many people did it reach" is the first question after a survey asks the wrong thing.
     *
     * <p>The detail carries the counts and never a question. {@code surveys} is where the text
     * lives, and it can be deleted; this table cannot.
     */
    PROJECT_SURVEY_SENT("project.survey_sent", "project"),

    /**
     * §4.8's PM-20 (#80): a tracking file was applied to a campaign's parcels.
     *
     * <p>Audited because one upload rewrites what several thousand backers are told about
     * where their reward is, and because it is the only write on the platform that can put a
     * parcel back from delivered to shipped — {@code Fulfilment} deliberately has no state
     * machine, so this table is the whole of the history of a correction.
     *
     * <p>The detail carries counts and never a tracking number. This table has no retention
     * rule and refuses {@code DELETE}; where somebody's parcel went is not a fact to put in
     * it. The refused rows are counted here and named in the response, which is where the
     * creator can act on them.
     */
    PROJECT_FULFILMENTS_IMPORTED("project.fulfilments_imported", "project"),

    /**
     * §4.11's AD-02 (#103): trust and safety stopped a live campaign.
     *
     * <p>The most consequential privileged action on the platform: it is terminal, it ends
     * every pledge on the campaign, and the creator cannot undo it or appeal it into the
     * state it was in. "Who suspended this campaign, when, and under what reason" is the
     * first question of every conversation that follows, and the three moderation
     * decisions are already recorded here for a weaker version of the same reason.
     *
     * <p>The detail carries the edge and not the reason. The reason is prose a moderator
     * wrote about somebody's campaign and it is already on the transition row, which can
     * be corrected; this table cannot.
     */
    PROJECT_SUSPENDED("project.suspended", "project"),

    /**
     * §4.11's AD-04 (#104): staff read the account list.
     *
     * <p><strong>A read, audited, which almost none of them are.</strong> It is the one
     * endpoint on the platform that returns other people's email addresses in bulk to
     * somebody who has no relationship with them, and §4.7's CD-11 export is audited for
     * the weaker version of the same reason. "Who looked up whom" is the question an
     * investigation into a leak starts from, and it cannot be asked afterwards of a read
     * nobody recorded.
     *
     * <p>The detail carries the filters and the count and never a row. The search term is
     * what staff typed and is frequently an address, so it stays out of the one table with
     * no retention rule.
     *
     * <p>The entity is the staff account rather than a subject, because a search has no
     * single subject -- which is exactly what makes it worth recording.
     */
    ACCOUNTS_SEARCHED("account.searched", "account"),

    /**
     * §4.11's AD-04 (#104): staff stopped an account.
     *
     * <p>The strongest action anybody can take against a person on this platform short of
     * deleting them: they cannot sign in, and every session they had is revoked in the
     * same transaction. Reversible, unlike a campaign's suspension, which is why both the
     * ban and the reinstatement are recorded -- an account that is not suspended today
     * tells you nothing about whether it ever was.
     *
     * <p>The detail carries the edge and the session count, never the reason: that is
     * prose a moderator wrote about a person, it is on the account where it can be
     * corrected, and this table cannot be.
     */
    ACCOUNT_SUSPENDED("account.suspended", "account"),

    /** §4.11's AD-04 (#104): staff let an account back in. See {@link #ACCOUNT_SUSPENDED}. */
    ACCOUNT_REINSTATED("account.reinstated", "account"),

    /** A second factor was confirmed and is now required to sign in. */
    TWO_FACTOR_ENABLED("two_factor.enabled", "account"),

    /** A second factor was removed, or somebody tried to remove one. */
    TWO_FACTOR_DISABLED("two_factor.disabled", "account"),

    /** One session was revoked, by its owner or by the platform. */
    SESSION_REVOKED("session.revoked", "session"),

    /** Every live session an account had was revoked at once. */
    SESSIONS_REVOKED("session.revoked_all", "account"),

    // ------------------------------------------------------------------
    // AD-02's report queue (#102). The two outcomes a moderator can choose.
    //
    // The entity is the report and not what was reported, for the reason
    // COLLABORATOR_INVITED gives about grants: the report is the thing that is
    // decided, and two rows about one report are only a history if they share an
    // identifier. Which campaign or account it was about is in `detail`, and on
    // the `content_reports` row this identifier names.
    //
    // Both outcomes are recorded, not only the one that agreed with the reporter.
    // "Who dismissed the fourteen reports about this campaign" is the question an
    // investigation starts from, and a table of upheld reports cannot answer it.
    // ------------------------------------------------------------------

    /** Moderation agreed with a report. Does not itself suspend or remove anything. */
    REPORT_UPHELD("report.upheld", "report"),

    /** Moderation did not agree with a report. */
    REPORT_DISMISSED("report.dismissed", "report"),

    // ------------------------------------------------------------------
    // §4.1's A-06, A-12 and A-13 (#271, #277). What happened to a credential,
    // recorded whether or not the person who caused it was signed in.
    //
    // The entity is the account rather than the credential row: a credential has
    // no identifier anybody outside `auth` can name, and the question these rows
    // answer -- "what has been done to this account's ability to sign in" -- is
    // asked about the account.
    //
    // NOTHING HERE CARRIES AN ADDRESS OR A TOKEN. `detail` says which way the
    // change went and never what it went to; an audit table is the wrong place
    // to accumulate a history of somebody's mailboxes, and §17.4's erasure does
    // not reach into it.
    // ------------------------------------------------------------------

    /** The password was changed by somebody who knew the old one — A-13. */
    PASSWORD_CHANGED("account.password_changed", "account"),

    /** A reset link was asked for. Recorded even when no account matched — A-06. */
    PASSWORD_RESET_REQUESTED("account.password_reset_requested", "account"),

    /** A reset link was spent and a new password set without the old one — A-06. */
    PASSWORD_RESET("account.password_reset", "account"),

    /** An address change was asked for and is waiting on the new address — A-12. */
    EMAIL_CHANGE_REQUESTED("account.email_change_requested", "account"),

    /** The new address proved itself and {@code users.email} moved — A-12. */
    EMAIL_CHANGED("account.email_changed", "account"),

    /**
     * §4.11's AD-14 (#314): staff read the trail.
     *
     * <p><strong>The trail records being read, and the row lands in the trail.</strong>
     * That is the intended shape and not an oversight. This table is the only place that
     * can answer "who looked at the record of who did what", and an audit surface that is
     * itself unaudited is the surface an investigation starts by distrusting. The noise it
     * adds is one row per page read by a member of staff, against a table that already
     * carries every privileged write on the platform.
     *
     * <p>The detail carries the filter and the number of rows returned, and never a row:
     * repeating the contents of the trail into the trail would double it every time
     * somebody looked.
     *
     * <p>The entity is the staff account, following {@link #ACCOUNTS_SEARCHED} — a read of
     * a list has no single subject, which is exactly what makes it worth recording.
     */
    AUDIT_TRAIL_READ("audit.trail_read", "account"),

    /**
     * §4.11's AD-05 (#304): staff read the payment log.
     *
     * <p>Audited for {@link #ACCOUNTS_SEARCHED}'s reason rather than for a financial one.
     * The rows themselves are already immutable and already reconciled; what is not
     * otherwise recorded anywhere is that somebody with no relationship to a pledge went
     * looking at what a named person paid, when, and which card was refused.
     */
    PAYMENT_LOG_READ("payment.log_read", "account"),

    /**
     * §4.11's AD-05 (#305): staff read the ledger.
     *
     * <p>The same argument as {@link #PAYMENT_LOG_READ}, and one of its own: §22.1 makes
     * these rows a regulatory record, and a regulatory record is one whose readers are
     * known as well as whose writers are.
     */
    LEDGER_READ("ledger.read", "account"),

    /**
     * A reconciliation somebody asked for, rather than the nightly one — #106.
     *
     * <p>Recorded because it is a decision as much as a read: it is what a member of
     * finance does when they suspect the books are wrong, and "when did anybody last
     * check, and who" is precisely the question asked afterwards. The nightly pass writes
     * no audit row, deliberately — it has no actor, and a scheduled job filling this table
     * every night would bury the passes a person asked for.
     */
    LEDGER_RECONCILED("ledger.reconciled", "account"),

    /**
     * §4.11's AD-02 (#108): staff read the fraud queue, or marked one of its rows seen.
     *
     * <p>The same argument as {@link #PAYMENT_LOG_READ}, and one that is sharper. This
     * queue is a list of people the platform's own arithmetic has found suspicious, on
     * numbers nobody has yet measured against a real chargeback rate. A list like that is
     * one whose readers should be known — both because §17.4 requires it of a read this
     * privileged, and because the first question after somebody is wrongly treated as a
     * fraudster is who saw the score.
     *
     * <p>The entity is the staff account rather than a subject, following
     * {@link #AUDIT_TRAIL_READ}: a read of a list has no single subject, and a detail that
     * reproduced the queue would be a second copy of it with no retention rule.
     */
    RISK_QUEUE_READ("risk.queue_read", "account"),

    /**
     * §4.11's role model (#295): somebody was given an authority over the platform.
     *
     * <p><strong>The most privileged action there is</strong>, because it is the one that
     * makes the others possible: granting {@code FINANCE} is granting every refund that
     * role will ever issue. The entity is the account that received the role rather than
     * the administrator who gave it, so that "what has been done to this account" answers
     * with the grant — the administrator is the actor, which is the column that question
     * is not asked of.
     *
     * <p>The detail carries the role and the note. A grant with no reason recorded is one
     * nobody can review, and V48's {@code granted_by} answers who but never why.
     */
    STAFF_ROLE_GRANTED("staff.role_granted", "account"),

    /**
     * The withdrawal (#295).
     *
     * <p>Recorded even though the row is gone, which is the point: a deleted grant leaves
     * no trace in {@code staff_role_grants}, so this table is the only place that can say
     * somebody used to be able to approve payouts. Without it, the answer to "who removed
     * her access, and when" is that nobody knows.
     */
    STAFF_ROLE_REVOKED("staff.role_revoked", "account"),

    /**
     * AD-11 (#311): the platform changed what it charges.
     *
     * <p>The entity is the schedule that was opened rather than the one that was closed:
     * a replacement is one decision, and keying it on the new row makes "why does this
     * schedule exist" answerable from the row itself.
     */
    FEE_SCHEDULE_CHANGED("fee.schedule_changed", "fee_schedule"),

    /** AD-12 (#312): a feature flag was created, edited, or switched. */
    FEATURE_FLAG_CHANGED("feature.flag_changed", "feature_flag"),

    /**
     * AD-08 (#309): a category, subcategory or tag was added, renamed or retired.
     *
     * <p>Privileged because §4.3 makes the taxonomy the thing every campaign is filed
     * under: renaming a category rewrites what several thousand campaigns say they are.
     */
    TAXONOMY_CHANGED("taxonomy.changed", "taxonomy"),

    /**
     * AD-15 (#315): the copy of a platform email was rewritten.
     *
     * <p>The entity is the version, so the trail and {@code email_template_versions} agree
     * about which edit is being talked about.
     */
    EMAIL_TEMPLATE_EDITED("email.template_edited", "email_template"),

    /** AD-10 (#310): staff answered, assigned or closed a support ticket. */
    SUPPORT_TICKET_HANDLED("support.ticket_handled", "support_ticket"),

    /**
     * AD-06 (#67, #307): money was sent back.
     *
     * <p>The entity is the refund rather than the pledge, unlike most of this enum: a
     * pledge can be refunded more than once — partially — and three rows about one
     * refund are only a history if they share an identifier.
     */
    REFUND_ISSUED("refund.issued", "refund"),

    /** AD-07 (#68, #308): evidence was submitted, or an outcome recorded, on a dispute. */
    DISPUTE_HANDLED("dispute.handled", "dispute"),

    /**
     * AD-05 (#69, #306): a payout was calculated from a campaign's collections.
     *
     * <p>Recorded although no money has moved. The calculation is the decision that fixes
     * what a creator will be paid, and it is the figure an approver signs — so "who
     * produced this number, and when" has to be answerable separately from "who approved
     * it".
     */
    PAYOUT_CALCULATED("payout.calculated", "payout"),

    /**
     * One signature on a payout (#69, #306).
     *
     * <p>One row per approver, which is what makes dual approval visible in the trail as
     * two entries by two accounts. A single row naming both would be one statement about
     * two decisions taken at different times by different people.
     */
    PAYOUT_APPROVED("payout.approved", "payout"),

    /** The money left (#69, #306). */
    PAYOUT_SENT("payout.sent", "payout"),

    /**
     * §22.1's anti-money-laundering row (#105): a creator submitted an identity document.
     *
     * <p>The entity is the creator and not a member of staff, because "a photograph of my
     * passport was stored" is an event about the person in the photograph. §17.4 is why it
     * is recorded at all: a platform that holds an identity document should be able to say
     * when it started.
     */
    IDENTITY_DOCUMENT_SUBMITTED("identity.document_submitted", "account"),

    /**
     * <strong>Somebody looked at an identity document</strong> — #105.
     *
     * <p>The most sensitive read on the platform, and the reason
     * {@code IdentityVerifications.openDocument} is the only route to a document's bytes.
     * "Who has looked at my passport" is a question a creator is entitled to have answered,
     * and it is unanswerable unless every opening writes a row.
     *
     * <p>The entity is the creator, so that "what has been done to this account" answers
     * it; the actor is the member of staff. The detail names the kind of document and
     * never anything from inside it.
     */
    IDENTITY_DOCUMENT_READ("identity.document_read", "account"),

    /** #105: a member of staff was satisfied by a creator's documents. */
    IDENTITY_VERIFICATION_APPROVED("identity.verification_approved", "account"),

    /**
     * #105: a member of staff was not satisfied.
     *
     * <p>The reason is on the verification and deliberately not in this detail: the closed
     * set of reasons is shown to the creator, and an audit row that repeated it would be a
     * second copy in a table with a different retention rule.
     */
    IDENTITY_VERIFICATION_REJECTED("identity.verification_rejected", "account"),

    /**
     * A subscription plan was added to the catalogue.
     *
     * <p>Filed under AD-11 with the fee schedule, because it is the same kind of decision:
     * what the platform charges, changed by one screen, taking effect for everybody at
     * once. What differs is who pays — a fee comes out of a backer's pledge and this comes
     * out of a creator's pocket — and that is a difference in subject rather than in the
     * authority being exercised.
     *
     * <p>The detail carries the numbers and not the prose. A plan's description is
     * marketing text, and copying it here would put it under a retention rule written for
     * privileged actions to answer a question nobody asks of this table.
     */
    SUBSCRIPTION_PLAN_CREATED("subscription.plan_created", "subscription_plan"),

    /**
     * A subscription plan's price, limits or listing changed.
     *
     * <p><strong>The trail is the only history this table has</strong>, and that is why
     * every edit writes one. A plan is edited in place, unlike a fee schedule — V62 argues
     * why that is safe for anybody's bill — so "what did Growth allow in July" is
     * answerable from these rows and from nowhere else.
     */
    SUBSCRIPTION_PLAN_CHANGED("subscription.plan_changed", "subscription_plan"),

    /**
     * A member of staff recorded that a subscription's payment arrived.
     *
     * <p>The most consequential thing anybody does to a subscription: it is what turns a
     * chosen plan into an entitlement to publish. It exists as a staff action rather than a
     * provider callback because no payment provider is integrated (#60), and V62's header
     * argues why that is honest rather than a stub.
     *
     * <p>The entity is the subscription and the actor is the member of staff, so that
     * "who let this account publish, and on what evidence" is one row. The detail names
     * the plan, the amount and the period, which is what a reconciliation against a bank
     * statement needs.
     */
    SUBSCRIPTION_ACTIVATED("subscription.activated", "subscription"),

    /**
     * A member of staff ended a subscription outright.
     *
     * <p>Not what a creator cancelling does — that leaves the row active until the period
     * they paid for runs out, and takes nothing away, so there is nothing here for it to
     * record. This is the one that removes an entitlement somebody is holding, which is
     * why it is audited and why its reason is required.
     */
    SUBSCRIPTION_CANCELED("subscription.canceled", "subscription"),

    /**
     * Somebody exported the subscription revenue report.
     *
     * <p>Privileged despite changing nothing, for {@link #ACCOUNT_EXPORTED}'s and
     * {@link #PROJECT_BACKERS_EXPORTED}'s reason: the file leaves the platform, and what
     * left it and when is the only thing anybody can answer afterwards. This one carries
     * every paying creator's address and what they were charged, which is the whole
     * subscriber list in one attachment.
     *
     * <p>The entity is the member of staff who took it — there is no revenue object to
     * name, and the actor twice over is better than an invented identifier. The detail
     * carries the period, the filter and the row count, and never a row: §17.4 keeps
     * personal data out of the one table with no retention rule.
     */
    SUBSCRIPTION_REVENUE_EXPORTED("subscription.revenue_exported", "user"),

    /**
     * A version of one of §22.2's legal documents was published.
     *
     * <p><strong>The most far-reaching thing anybody does from the console.</strong>
     * Publishing a version of the creator agreement changes what every creator who submits
     * after it is bound by, and it cannot be undone — V65's trigger makes a published
     * version immutable, so the correction is another publication and both rows are here.
     *
     * <p>The entity is the governing (Azerbaijani) version, because that is the text that
     * governs and the one an acceptance names. The detail carries the kind, the version,
     * the languages published with it and the content hash of the governing text — which
     * is what lets somebody establish, years later, that the document in the table is the
     * document that was published.
     */
    LEGAL_DOCUMENT_PUBLISHED("legal.document_published", "legal_document"),

    /**
     * A member of staff read what an account has agreed to, and when.
     *
     * <p>Audited because it is a read of somebody's own record rather than of the
     * platform's — {@code AUDIT_TRAIL_READ}'s argument, unchanged: a screen that says who
     * agreed to what, from which address, is one whose use should be answerable. It is
     * cheap to record and the absence is only noticed during the investigation that needed
     * it.
     *
     * <p>The entity is the account whose record was read, not the member of staff, so that
     * "who has looked at this person's file" is one query.
     */
    ACCEPTANCE_RECORD_READ("legal.acceptance_record_read", "account"),

    /**
     * A compliance requirement was waived for one account, for a bounded time.
     *
     * <p><strong>The row that makes an override answerable.</strong> An override is the
     * mechanism by which every control in epic #421 can be bypassed by one person in one
     * click, and #436's argument is that one which is invisible after the fact is
     * indistinguishable from a control that was never there. {@code compliance_overrides}
     * is the record a gate reads; this is the record an auditor reads, and it survives the
     * subject's erasure where the override itself cascades away.
     *
     * <p>The entity is the account the exception was granted to, not the override, so that
     * "what has been waived for this person" is one query and stays one query after the
     * overrides themselves are gone.
     */
    COMPLIANCE_OVERRIDE_GRANTED("compliance.override_granted", "account"),

    /**
     * A live override was withdrawn before it would have expired.
     *
     * <p>Its own action rather than a detail on the grant, because it is somebody else's
     * decision at a different time and §22.1's question is "who authorised this" in both
     * directions. An override that expired on its own writes nothing here: nothing
     * happened, which is the point of an expiry that is a comparison rather than a job.
     */
    COMPLIANCE_OVERRIDE_REVOKED("compliance.override_revoked", "account"),

    /**
     * A moderator closed the escalation raised by a lapsed §5.5 update obligation.
     *
     * <p><strong>The resolution is audited and the lapse is not</strong>, and the asymmetry is
     * deliberate. A lapse is something that happened to a campaign because time passed — the row
     * carries it, and an audit entry for "nobody did anything" would be the platform recording
     * the absence of an action under somebody's name. A resolution is a decision a person took,
     * and §4.11's AD-02 is the neighbouring one it must be readable beside.
     *
     * <p>The entity is the campaign. The detail carries when it lapsed and what it was due,
     * because the resolution note lives on the row and the row is cleared by the next lapse.
     */
    UPDATE_OBLIGATION_RESOLVED("obligation.update_resolved", "project"),

    /**
     * A creator recorded, or changed, who they legally are.
     *
     * <p><strong>The actor is the creator, not a member of staff</strong>, and this is one of
     * the few actions in this enum where that is so. It is here anyway, because the value
     * decides withholding on a payout, decides which party the creator agreement binds, and is
     * the name #429's certificate subject and #432's account holder are matched against. A
     * change to it days before a payout is the shape of a fraud that would otherwise leave no
     * trace at all: the row carries only what it says now.
     *
     * <p>The entity is the account. The detail carries the subject kind, the legal name and
     * whether the subject is complete -- enough to reconstruct the sequence of names an account
     * has claimed, which is the question an investigation asks.
     */
    LEGAL_SUBJECT_RECORDED("compliance.legal_subject_recorded", "account"),

    /**
     * A member of staff read somebody's legal subject.
     *
     * <p>{@link #ACCEPTANCE_RECORD_READ}'s argument applied to the neighbouring screen: a read
     * of a person's own record rather than of the platform's should be answerable, it costs
     * nothing to record, and its absence is discovered only during the investigation that
     * needed it.
     *
     * <p>The entity is the account that was read, so that "who has looked at this person's
     * file" stays one query across both this and the acceptance record.
     */
    LEGAL_SUBJECT_READ("compliance.legal_subject_read", "account"),

    /**
     * A creator signed a legal document with a national e-signature.
     *
     * <p>Distinct from an acceptance, which is not audited at all -- a tick is recorded in
     * {@code document_acceptances} with its address and user agent, and that row is the
     * evidence. A signature is audited on top of the row because #429 says it is a privileged
     * action, and because the interesting failures are the ones that produce no acceptance: a
     * refused name match writes an audit entry and nothing else, and without it a creator
     * repeatedly failing to match a certificate to their account would be invisible.
     *
     * <p>The entity is the account. The detail carries the document, its version, the hash that
     * was signed and the certificate subject's name -- never the signature value, which is in
     * {@code signatures} and is large.
     */
    AGREEMENT_SIGNED("legal.agreement_signed", "account"),

    /**
     * A stored signature was read back.
     *
     * <p>#429: signing, "and every later read of a stored signature", is audited. The read is
     * the more sensitive of the two: the row carries a citizen's name and FIN under 17.4, and a
     * screen that discloses them is one whose use has to be answerable. Recorded for a member
     * of staff reading somebody else's and not for a creator reading their own, on
     * {@code AUDIT_TRAIL_READ}'s line -- a person looking at their own record is not a
     * disclosure.
     */
    SIGNED_AGREEMENT_READ("legal.signed_agreement_read", "account"),

    /**
     * A creator filed the account their money is to be sent to — #432.
     *
     * <p>{@link #LEGAL_SUBJECT_RECORDED}'s argument with money directly behind it. The row is
     * replaceable and carries only what it says now, so "when did this change and to what" is
     * unanswerable without this entry — and it is the first question a misdirected payout
     * produces.
     *
     * <p>Recorded on the refusal as well as the success: a destination whose holder does not
     * match the creator's legal name is stored in {@code NAME_MISMATCH} rather than rejected,
     * and a creator filing several differently-named accounts in an afternoon is a pattern that
     * exists only in this trail.
     *
     * <p>The detail carries the provider, the holder's name and the resulting state. It does
     * <strong>not</strong> carry the token — that is the value {@code PayoutRequest.toString}
     * and {@code PayoutDestination.toString} both redact, and an audit row is no more allowed
     * to hold it than a log line is.
     */
    PAYOUT_DESTINATION_RECORDED("compliance.payout_destination_recorded", "account"),

    /**
     * <strong>Somebody decided where a creator's money may go</strong> — #432.
     *
     * <p>One action for the confirmation and the refusal, distinguished by the outcome, on
     * {@link #PAYOUT_APPROVED}'s line: both are the same decision taken by the same capability
     * about the same row, and splitting them would make "who has ever ruled on this account's
     * destination" two queries.
     *
     * <p>V66 put {@code VERIFY_PAYOUT_DESTINATION} with COMPLIANCE and withheld it from
     * FINANCE precisely so that this entry and {@link #PAYOUT_SENT} name different people. An
     * audit trail where they are the same person is the arrangement §4.11 exists to prevent,
     * visible after the fact.
     */
    PAYOUT_DESTINATION_VERIFIED("compliance.payout_destination_verified", "account"),

    /**
     * A member of staff opened somebody's payout destination.
     *
     * <p>{@link #LEGAL_SUBJECT_READ}'s argument on the neighbouring panel. The row discloses
     * the name of the person a bank account belongs to, which is a fact about somebody rather
     * than about the platform, so the disclosure is answerable.
     *
     * <p>Recorded for opening one and deliberately not for listing the queue: the list says
     * that destinations are waiting, and opening one is what discloses a name. Auditing the
     * list would write fifty rows per refresh, which is how a trail stops being readable.
     */
    PAYOUT_DESTINATION_READ("compliance.payout_destination_read", "account");



    private final String action;
    private final String entityType;

    AuditAction(String action, String entityType) {
        this.action = action;
        this.entityType = entityType;
    }

    /** What goes in {@code audit_logs.action}. */
    public String action() {
        return action;
    }

    /** What goes in {@code audit_logs.entity_type}. */
    public String entityType() {
        return entityType;
    }
}
