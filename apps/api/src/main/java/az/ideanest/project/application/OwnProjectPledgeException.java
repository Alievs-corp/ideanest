package az.ideanest.project.application;

import java.util.UUID;

/**
 * The backer works on the campaign they are trying to pledge to — #575.
 *
 * <p><strong>Why a campaign's own team may not back it.</strong> Two of §6.1's edges are
 * decided by the denormalised {@code pledged_amount}: a creator may withdraw a {@code LIVE}
 * campaign early once it reaches 80% of its goal, and may extend it once it reaches 50%.
 * A pledge from the creator's own card counts towards both. A campaign at 60% in real money
 * could be topped up to 80% by its creator, withdrawn the same afternoon, and paid out on
 * everything — other backers' money included — weeks before the deadline they were shown,
 * at the cost of the fee on the top-up. The same pledge fakes the backer count and every
 * badge drawn from the total. A collaborator is the same person for this purpose: the grant
 * exists because the creator trusted them with the campaign.
 *
 * <p><strong>403 rather than 409.</strong> Every 409 in this module is about timing or
 * state, and waiting or reloading resolves it. Nothing does here: the request is refused
 * because of who sent it, for as long as they hold the relationship. Not 404 either — a
 * member of the team can already see the campaign, so there is nothing to hide from them,
 * which is the same reasoning {@link CapabilityNotGrantedException} gives.
 *
 * <p>Deliberately carries nothing about which role the backer holds. The client's answer is
 * the same for a creator and a collaborator, and a field nobody branches on is one more thing
 * to keep true.
 */
public class OwnProjectPledgeException extends RuntimeException {

    public OwnProjectPledgeException(UUID projectId, UUID backerId) {
        super("Account " + backerId + " works on project " + projectId + " and may not pledge to it");
    }
}
