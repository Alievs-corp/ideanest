package az.ideanest.user.application;

import az.ideanest.shared.EmailAddress;
import java.time.Instant;
import java.util.UUID;

/**
 * What another module is told about a user.
 *
 * <p>Not the entity. The entity is this module's internal shape and is free to
 * change; handing it out would make every field a published contract and every
 * caller a reason not to change one. It would also hand out a live JPA
 * instance, which another module could then modify outside this module's
 * transaction.
 *
 * @param deletionScheduledAt when this account is due to be anonymised, or null
 *     if nobody has asked for that. Part of the contract because an account in
 *     its grace period may sign in and may do almost nothing else, and every
 *     caller that decides whether an action is allowed needs to see it.
 * @param suspendedAt when trust and safety stopped this account, or null — §4.11's
 *     AD-04 (#104). Part of the contract for the same reason as the field above and one
 *     stronger: a suspended account may not sign in at all, and sign-in is in another
 *     module. Orthogonal to deletion, so both can be set at once
 * @param locale which of §21.1's languages this person reads, as they chose at
 *     registration. Part of the contract because the messages this platform sends about
 *     an account — A-06's reset link, A-12's two confirmations, A-13's notice — are
 *     composed in {@code auth}, and the alternative is the request's
 *     {@code Accept-Language}. That is the wrong answer twice over: a reset is
 *     frequently asked for from a borrowed device, and the notice that a password
 *     changed is triggered by whoever changed it, who may not be the account's owner
 */
public record UserAccount(
        UUID id,
        EmailAddress email,
        String name,
        String slug,
        boolean emailVerified,
        Instant deletionScheduledAt,
        Instant suspendedAt,
        String locale,
        /**
         * §4.2's P-10, the other half — the currency this account reads amounts in (#327).
         *
         * <p>A display preference and never a settlement currency: §21.2 collects in the
         * campaign's currency whatever this says. Equal to the platform's own base currency
         * for every account that has not chosen otherwise, which is the value V2 has
         * defaulted since the first migration.
         */
        String currency,
        /**
         * The address of the account's picture, or null for the many that have none.
         *
         * <p>Part of the contract for #324's list of blocked accounts, which shows the
         * person somebody blocked the way they appeared: a name alone is a weak way to
         * recognise somebody, and names are not unique. Public already — the profile and
         * the campaign page both serve it — so carrying it here publishes nothing new.
         */
        String avatarUrl) {

    /** Whether this account is inside its grace period and awaiting anonymisation. */
    public boolean deletionPending() {
        return deletionScheduledAt != null;
    }

    /** Whether trust and safety has stopped this account. What sign-in refuses on. */
    public boolean suspended() {
        return suspendedAt != null;
    }
}
