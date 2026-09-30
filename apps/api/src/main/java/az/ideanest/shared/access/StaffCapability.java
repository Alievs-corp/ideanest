package az.ideanest.shared.access;

/**
 * What a member of platform staff may do, named one authority at a time — #295.
 *
 * <p><strong>This is {@link ProjectCapability}'s argument applied to the other kind of
 * authority.</strong> That enum exists because four modules wanted a fine-grained
 * permission check, could not name the project module's own enum, and each settled for
 * the coarsest question the project module happened to publish. Staff authorisation was
 * in a worse position: there was no fine-grained question to ask at all, only
 * {@link PlatformStaff#requireStaff}, so every console endpoint asked "is this person
 * staff" and got the same answer whether it was about a comment or about a refund.
 *
 * <p><strong>Why the vocabulary is here and the roles are not.</strong> A capability is
 * named by the module that enforces it — the refund console says
 * {@code ISSUE_REFUND} — so it has to live somewhere every module may name, which is
 * {@code shared}. Which roles confer which capabilities is a policy the staff module
 * owns and nothing else needs to know; a caller that named a role would be re-deciding
 * that policy at the call site, and the fifth one to do it would get it wrong.
 *
 * <p><strong>They are deliberately coarser than the endpoint list.</strong> Sixteen
 * console modules do not need sixteen capabilities: reading the payment log and reading
 * the ledger are the same authority over the same facts, and splitting them would
 * produce a grant screen nobody can reason about. The line drawn here is "could a
 * mistake with this be undone", which is why reading finance and moving money are two
 * and not one.
 */
public enum StaffCapability {

    /**
     * Work the queues: the submission queue, content reports, and the decisions that
     * end them. AD-01, AD-02, AD-09.
     *
     * <p>Includes suspending a campaign, which is terminal and is still here rather
     * than behind its own capability: a moderator who may reject a campaign before
     * launch and may not stop one after it is a moderator who has to escalate the
     * urgent half of the job.
     */
    MODERATE_CONTENT,

    /**
     * Search, inspect, ban and reinstate an account. AD-04.
     *
     * <p>Separate from {@link #MODERATE_CONTENT} because it is the one authority on
     * the platform that hands somebody else's email address to an account with no
     * relationship to them — {@code AdminUserController} audits every read for exactly
     * that reason — and a person hired to clear comments does not need it.
     */
    ADMINISTER_ACCOUNTS,

    /**
     * Editorial collections, badges, open calls, placement, and the taxonomy behind
     * them. AD-03, AD-08.
     *
     * <p>Curation and taxonomy are one capability because they are one job: the person
     * who decides that a collection exists is the person who decides what category it
     * draws from.
     */
    CURATE,

    /**
     * Read the money: the payment log, the ledger, the platform's own figures.
     * AD-05, AD-13.
     *
     * <p>Reading is separated from moving because the mistakes are not comparable. A
     * wrong read is a wrong answer in a meeting; a wrong refund is somebody's money.
     */
    VIEW_FINANCE,

    /** Issue a full or partial refund against a captured charge. AD-06. */
    ISSUE_REFUND,

    /**
     * Record evidence and an outcome against a dispute a provider raised. AD-07.
     *
     * <p>Not folded into {@link #ISSUE_REFUND}: a chargeback is answered rather than
     * granted, and the person who assembles the evidence is not necessarily the person
     * trusted to hand money back on request.
     */
    MANAGE_DISPUTES,

    /**
     * Approve a payout to a creator. AD-05.
     *
     * <p>Its own capability because §4.11 requires dual approval above a threshold, and
     * dual approval means two accounts that each hold <em>this</em> — a rule that
     * cannot be stated if approving is a side effect of being in finance.
     */
    APPROVE_PAYOUT,

    /** Answer support tickets and read the account context behind one. AD-10. */
    HANDLE_SUPPORT,

    /**
     * Change what the platform charges, what is switched on, and what it writes to
     * people. AD-11, AD-12, AD-15.
     *
     * <p>One capability over three screens, and the narrowest grant on the list: each
     * of them changes the behaviour of the running platform for everybody at once, and
     * none of them is part of anybody's daily work.
     */
    CONFIGURE_PLATFORM,

    /**
     * Read the audit trail. AD-14.
     *
     * <p>Held widely rather than narrowly, deliberately. A trail only the people it
     * would incriminate can read is a trail; a trail every member of staff can read is
     * a control.
     */
    VIEW_AUDIT,

    /** Read queue depth, failed jobs and provider status. AD-16. */
    VIEW_HEALTH,

    /**
     * Publish a version of one of §22.2's legal documents. #425, narrowed by #436.
     *
     * <p><strong>Its own capability because of what publishing does, not because of what
     * the screen looks like.</strong> It shipped under {@link #CONFIGURE_PLATFORM} — the
     * authority that changes a fee schedule — and V65 said at the time that #436 would
     * narrow it. The two are not the same authority: a fee change prices the next payout
     * and is reversed by opening new terms, and publishing a version of the creator
     * agreement changes what every creator submitting after it is bound by and cannot be
     * reversed at all, because V65's trigger makes a published version immutable.
     *
     * <p>Held by {@code SUPER_ADMIN} alone today, which is where it already was. The
     * point of separating it is that it can now be narrowed further, or granted to a
     * fifth role, without also handing over the feature flags.
     */
    PUBLISH_LEGAL_DOCUMENT,

    /**
     * Read what an account has agreed to, and when. #425's record, #436's row.
     *
     * <p>Who agreed to which version of which document, from which address. Not a
     * document about a person, which is why {@code document_acceptances} is never swept
     * — and still somebody's own record rather than the platform's, which is why the read
     * is audited under {@code ACCEPTANCE_RECORD_READ}.
     *
     * <p>Separate from {@link #ADMINISTER_ACCOUNTS} because a moderator triaging a report
     * has no use for it, and one capability wide enough for both would put a consent
     * history in front of everybody who clears the comment queue.
     */
    READ_ACCEPTANCE_RECORD,

    /**
     * Read another account's signed creator agreement. #429's signature, #436's row.
     *
     * <p><strong>Not the same read as {@link #READ_ACCEPTANCE_RECORD}, and the difference
     * is a citizen's name and FİN.</strong> An acceptance is a reference and a timestamp.
     * A signature carries the certificate subject the state issued, which is personal data
     * under §17.4 and is the strongest identifying material the platform holds outside
     * V58's documents.
     *
     * <p>So it is narrow on purpose: {@code COMPLIANCE} and {@code SUPER_ADMIN}. A
     * support agent answering "did I sign this" does not need to read the certificate to
     * answer it, and {@code READ_ACCEPTANCE_RECORD} is the question they are actually
     * asking.
     */
    READ_SIGNED_AGREEMENT,

    /**
     * Approve or reject an identity verification. #105's queue, which has existed with no
     * row in §3.1's matrix since it was built.
     *
     * <p>The decision, not the document — {@link #OPEN_IDENTITY_DOCUMENT} is that, and the
     * split is the whole of #436's argument about V58. A reviewer holds both in practice;
     * they are two capabilities so that the narrower one can be withdrawn without also
     * closing the queue, and so that "who may open a passport photograph" is a question
     * with an answer.
     *
     * <p>Whose decision it is not: the subject's. Enforced by
     * {@code identity_verifications_reviewer_is_not_the_subject} rather than here, because
     * a capability says what a role may do and says nothing about who it may do it to.
     */
    REVIEW_IDENTITY_VERIFICATION,

    /**
     * Open an identity document. <strong>The most sensitive read on the platform.</strong>
     *
     * <p>V58 encrypts these in the application, keeps them for days rather than for the
     * life of the account, and audits every opening. That design assumes a small number of
     * people, and the assumption is only true if there is a capability narrow enough to
     * express it: folded into {@link #MODERATE_CONTENT} it would be held by everybody who
     * reviews a reported comment, and the retention sweep would be protecting a photograph
     * of somebody's passport from nobody.
     *
     * <p>Narrower than moderation and narrower than administration in intent; in the role
     * table it is {@code COMPLIANCE} and {@code SUPER_ADMIN}, and the second is there
     * because an administrator can grant themselves the first — see {@code StaffRole} on
     * why a listed subset there would describe a restriction that does not exist.
     */
    OPEN_IDENTITY_DOCUMENT,

    /**
     * Confirm that a payout destination belongs to the creator it is filed under. #432.
     *
     * <p><strong>Deliberately not {@code FINANCE}'s.</strong> Finance holds "initiate a
     * payout"; a role that also decided the destination was correct would be one person
     * holding both halves of the arrangement §4.11's dual approval exists to prevent. It
     * is the same argument {@code StaffRole.FINANCE} already makes about
     * {@link #APPROVE_PAYOUT}, applied one step earlier in the same sequence, and V66's
     * header records the decision so that a later reader does not re-open it by accident.
     */
    VERIFY_PAYOUT_DESTINATION,

    /**
     * Waive a compliance requirement for one account, for a bounded time. #436.
     *
     * <p><strong>The dangerous one.</strong> An override exists because rules meet cases
     * nobody anticipated, and it is also the mechanism by which every control this epic
     * adds can be bypassed by one person in one click.
     *
     * <p>What keeps it honest is not the capability — it is that
     * {@code compliance_overrides} makes an override a row that expires, carries a reason
     * from a closed set plus the grantor's own words, cannot be granted to oneself, and is
     * drawn on the account it was applied to. The capability decides who may write that
     * row; the table decides what the row has to say.
     */
    GRANT_COMPLIANCE_OVERRIDE,

    /**
     * Grant and withdraw the roles above. #295 itself.
     *
     * <p>Held by {@code SUPER_ADMIN} alone. Anybody who can grant themselves a
     * capability effectively holds every capability, so this is the one that decides
     * what the rest of the enum is worth.
     */
    ADMINISTER_STAFF,

    /**
     * Read the financial statistics as a partner sees them: aggregates only, scaled by the
     * partner's agreed percentage. #203, part of #202.
     *
     * <p><strong>The only capability {@code PARTNER} holds, and deliberately not
     * {@link #VIEW_FINANCE}.</strong> {@code VIEW_FINANCE} opens the payments journal, the
     * ledger and the refund queue: every individual transaction, who made it and for how
     * much. A partner is owed a share of the totals and is owed none of that, so the
     * capability that reads the rows must not be the one that reads the sums.
     *
     * <p>Holding it does not decide what the caller sees. A caller holding a super-admin
     * role gets the real figures from the same endpoint; a partner gets each figure
     * multiplied by their percentage. That decision is made on the server from the account's
     * roles and profile, never from anything the client sends.
     */
    VIEW_PARTNER_STATISTICS
}
