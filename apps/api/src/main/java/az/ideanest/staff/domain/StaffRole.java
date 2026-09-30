package az.ideanest.staff.domain;

import az.ideanest.shared.access.StaffCapability;
import java.util.Set;

/**
 * The seven kinds of staff account, and what each of them may do — #295, #436, #203.
 *
 * <p><strong>The capability sets are here rather than in the database</strong>, and
 * V48's header has the argument in full: this migration ships beside eleven new console
 * modules that each introduce a capability, and a capability set stored per account
 * would make every one of those a data migration in which the rows that were missed are
 * invisible until somebody cannot do their job.
 *
 * <p><strong>Five rather than one per console module.</strong> A role exists to be
 * granted by a person who is thinking about a colleague and not about an endpoint list;
 * sixteen roles named after screens would be granted in the combination that made the
 * last complaint go away.
 *
 * <p><strong>The fifth arrived because a capability had nowhere narrow enough to go.</strong>
 * #436 added the authority to open an identity document, and V58's design — encrypted in
 * the application, kept for days, every opening audited — assumes a small number of people.
 * Folded into {@link #MODERATOR} it would have been held by everybody who reviews a
 * reported comment, which is the accident this enum exists to prevent. {@link #COMPLIANCE}
 * is that small number of people, and V66's header has the argument in full.
 *
 * <p>An account may hold several, and holds the union — see V48 on why the primary key
 * is the pair. Nothing here takes a capability away, which is what makes a union the
 * right combination and leaves no precedence rule to get wrong.
 *
 * <p><strong>{@link #SUPER_ADMIN} is what this role was called {@code ADMINISTRATOR}
 * until #212.</strong> The name is stored in {@code staff_role_grants}, so it could not be
 * renamed in place under a rolling deployment: V88 taught the application both names, and
 * V90 converted the rows and removed the old one. Code that asks "is this an administrator"
 * asks {@link #isSuperAdmin()}, which is the one place that knows which role that is.
 *
 * <p><strong>{@link #PARTNER} is the one role that sees no individual record.</strong> It
 * holds a single capability, so on its own it opens nothing but the aggregate statistics.
 * An account that also holds another role holds the union, as always, which is why granting
 * a partner any other role is a decision to make deliberately and not a side effect.
 */
public enum StaffRole {

    /**
     * The queues: campaigns awaiting review, reports about content, and the account
     * bans that answer the worst of them.
     *
     * <p>Carries {@link StaffCapability#ADMINISTER_ACCOUNTS} because AD-02's suspension
     * and AD-04's ban are the same decision reached from two directions — a report is
     * triaged by looking at who filed it and who it is about — and a moderator who
     * cannot open the account behind a report has to ask somebody else to look.
     */
    MODERATOR(Set.of(
            StaffCapability.MODERATE_CONTENT,
            StaffCapability.ADMINISTER_ACCOUNTS,
            StaffCapability.HANDLE_SUPPORT,
            StaffCapability.VIEW_AUDIT)),

    /**
     * The front page: collections, badges, open calls, placement, and the taxonomy
     * they draw from.
     *
     * <p>The narrowest role, and the only one that touches no personal data at all. It
     * exists so that the person who arranges the home page does not have to be trusted
     * with the report queue to do it.
     */
    CURATOR(Set.of(StaffCapability.CURATE, StaffCapability.VIEW_AUDIT)),

    /**
     * The money: the payment log, the ledger, refunds, disputes and the platform's own
     * figures.
     *
     * <p><strong>{@link StaffCapability#APPROVE_PAYOUT} is deliberately absent.</strong>
     * §4.11 requires dual approval on a payout above a threshold, and a role that
     * conferred both issuing and approving would make the second signature a formality
     * whenever the finance team is one person. Approving is {@link #SUPER_ADMIN}'s,
     * so the second signature is somebody else by construction.
     */
    FINANCE(Set.of(
            StaffCapability.VIEW_FINANCE,
            StaffCapability.ISSUE_REFUND,
            StaffCapability.MANAGE_DISPUTES,
            StaffCapability.HANDLE_SUPPORT,
            StaffCapability.VIEW_AUDIT)),

    /**
     * Who somebody is: identity verification, legal subject, and the payout destination
     * money will be sent to. #436.
     *
     * <p><strong>The narrowest role that touches the most sensitive data</strong>, which is
     * not a contradiction: it is narrow *because* of what it touches. It carries neither
     * {@link StaffCapability#MODERATE_CONTENT} nor {@link StaffCapability#VIEW_FINANCE} — a
     * compliance reviewer approves a verification, and does not reject campaigns or read
     * the ledger. Somebody who does both jobs holds both roles, which shows on the staff
     * screen; widening {@link #MODERATOR} instead would have hidden it.
     *
     * <p><strong>{@link StaffCapability#VERIFY_PAYOUT_DESTINATION} is here rather than in
     * {@link #FINANCE}</strong>, for the reason {@link #FINANCE} gives about
     * {@link StaffCapability#APPROVE_PAYOUT} one step later in the same sequence: the role
     * that decides where money goes must not also be the role that certifies the
     * destination is correct.
     *
     * <p><strong>{@link StaffCapability#GRANT_COMPLIANCE_OVERRIDE} is deliberately
     * absent</strong>, and it is the same argument a third time. A reviewer who could waive
     * the requirement they enforce holds both halves of it, and the waiver would stop being
     * an exception somebody escalated for. Overrides are {@link #SUPER_ADMIN}'s, so an
     * exception to a compliance rule is always signed by somebody outside compliance.
     */
    COMPLIANCE(Set.of(
            StaffCapability.REVIEW_IDENTITY_VERIFICATION,
            StaffCapability.OPEN_IDENTITY_DOCUMENT,
            StaffCapability.VERIFY_PAYOUT_DESTINATION,
            StaffCapability.READ_ACCEPTANCE_RECORD,
            StaffCapability.READ_SIGNED_AGREEMENT,
            StaffCapability.VIEW_AUDIT)),

    /**
     * Everything, including the ability to grant it: sees and may do everything, including
     * the real, unscaled financial figures, and is the only kind of account that can create
     * or change a {@link #PARTNER}. Called {@code ADMINISTRATOR} until #212.
     *
     * <p>Every capability rather than a listed subset, and that is a decision to
     * re-examine rather than a shortcut: a super admin can grant themselves any role
     * anyway, so a listed subset here would describe a restriction that does not exist
     * and would be believed. What limits a super admin is that every one of these
     * actions is audited under their name.
     *
     * <p>That includes {@link StaffCapability#OPEN_IDENTITY_DOCUMENT}, which #436 asks to
     * be "narrower than moderation and narrower than admin". The first half is built; the
     * second is not expressible here and saying otherwise would be the description of a
     * restriction that does not exist. What answers it is {@code compliance_overrides}'
     * argument applied to reads: every opening is audited under a name, and the audit
     * trail is the control on the role that can grant itself anything.
     */
    SUPER_ADMIN(Set.of(StaffCapability.values())),

    /**
     * A business partner: sees an agreed percentage of the financial statistics, in
     * aggregate, and nothing else unless a super admin opens a console module to them. #203.
     *
     * <p><strong>One capability, {@code VIEW_PARTNER_STATISTICS}, and not the audit
     * trail.</strong> Every other role can read the audit trail, and that is deliberate for
     * them — see {@link StaffCapability#VIEW_AUDIT}. For a partner it is the opposite: the
     * trail names accounts and amounts, which is exactly what a partner must not see, so
     * this role is the exception to "every role can read the trail" and a test says so.
     *
     * <p>Not {@link StaffCapability#VIEW_FINANCE} either. That capability opens the
     * payments journal and the ledger, which are individual transactions; the percentage a
     * partner is owed applies to totals, and a total is not a window onto its rows.
     */
    PARTNER(Set.of(StaffCapability.VIEW_PARTNER_STATISTICS));

    private final Set<StaffCapability> capabilities;

    StaffRole(Set<StaffCapability> capabilities) {
        this.capabilities = Set.copyOf(capabilities);
    }

    /** What holding this role confers. Immutable; the caller may not add to it. */
    public Set<StaffCapability> capabilities() {
        return capabilities;
    }

    /**
     * Whether this is the highest role. The one question to ask instead of comparing against
     * {@link #SUPER_ADMIN} directly, so that a future change to which roles count as highest
     * is made here and nowhere else.
     */
    public boolean isSuperAdmin() {
        return this == SUPER_ADMIN;
    }
}
