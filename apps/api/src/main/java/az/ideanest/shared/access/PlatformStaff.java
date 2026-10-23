package az.ideanest.shared.access;

import java.util.Set;
import java.util.UUID;

/**
 * Who counts as platform staff, asked from outside the module that currently knows.
 *
 * <p><strong>A second question, not a second interface for the same one.</strong>
 * {@link ProjectAuthorisation} answers "what has this campaign's creator granted this
 * account"; this answers "does this account work for the platform". They are different
 * kinds of authority — one is delegated by a user, the other is conferred by the
 * operator — and a moderator holds no capability on the campaign they are deciding
 * about, which is the point.
 *
 * <p><strong>The implementation is a role model since #295</strong>
 * ({@code staff.application.StaffDirectory}), and the prediction this comment used to
 * carry held exactly: the callers ask through an interface in {@code shared} rather than
 * naming the directory, so replacing what is behind it moved the implementation between
 * modules and changed no call site's shape.
 *
 * <p>It still fails closed. An account with no granted role and no bootstrap entry holds
 * nothing, so a deployment that configures neither has a console nobody can open rather
 * than one anybody can.
 *
 * <p><strong>Two questions, not one, and that is what #295 added.</strong>
 * {@link #isStaff} asks whether somebody works here; {@link #requireCapability} asks
 * whether this particular authority is theirs. Before the role model only the first
 * existed, so every console endpoint asked it — and a moderator hired to clear the
 * comment queue could issue a refund, because there was no narrower question to ask.
 * A caller that means to guard a privileged action names the capability; {@link
 * #requireStaff} remains for the surfaces where the answer really is "any member of
 * staff", such as reading the audit trail.
 *
 * <p>{@link #requireStaff} refuses with
 * {@code staff.application.NotAModeratorException} and {@link #requireCapability} with
 * that or {@code staff.application.InsufficientStaffCapabilityException} — both 403.
 * Described rather than declared for {@link ProjectAuthorisation}'s reason:
 * {@code shared} may not depend on a module.
 */
public interface PlatformStaff {

    /**
     * Whether this account may take a platform decision.
     *
     * <p>For a caller that has to branch rather than refuse. A caller that means to
     * refuse uses {@link #requireStaff} instead, so that the refusal is one sentence
     * and cannot be forgotten after the {@code if}.
     */
    boolean isStaff(UUID accountId);

    /**
     * Refuses unless this account is platform staff.
     *
     * @param accountId the authenticated caller, taken from the access token's subject
     *     and never from the request
     */
    void requireStaff(UUID accountId);

    /**
     * Everything this account may do, as the console renders it.
     *
     * <p>Empty for an account that does not work here, which is the same statement
     * {@link #isStaff} makes and is deliberately not a refusal: the console asks this
     * once on load to decide which screens to draw, and a 403 for the ordinary case of
     * "a signed-in visitor opened /admin" would be an error in the log for something
     * that is not an error.
     */
    Set<StaffCapability> capabilitiesOf(UUID accountId);

    /**
     * Refuses unless this account holds this particular authority.
     *
     * <p>The check every privileged endpoint makes. Two different refusals come out of
     * it — see the class comment — because "you do not work here" and "this is not yours
     * to do" lead the reader to different actions.
     *
     * @param accountId the authenticated caller, taken from the access token's subject
     *     and never from the request
     * @param capability what the endpoint needs. Named at the call site rather than
     *     derived from the path, so that a reader of the endpoint can see what it costs
     */
    void requireCapability(UUID accountId, StaffCapability capability);

    /**
     * Whether this account holds {@code SUPER_ADMIN}, granted or bootstrapped.
     *
     * <p>A role rather than a capability, because the one caller asks who somebody is and
     * not what a screen needs: {@code PublishingGate} lets the operator publish without
     * buying a plan from themselves.
     */
    boolean isSuperAdmin(UUID accountId);
}
