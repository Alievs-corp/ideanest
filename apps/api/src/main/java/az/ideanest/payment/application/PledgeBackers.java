package az.ideanest.payment.application;

import az.ideanest.pledge.application.PledgeRefunds;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Whose pledge each row of a money list is — so the refund and chargeback consoles can name the backer
 * through the console directory instead of showing eight characters of a pledge's identifier.
 *
 * <p>Read per list, once per distinct pledge: a page is fifty rows at most, and most of them share
 * pledges with their neighbours.
 */
@Service
public class PledgeBackers {

    private final PledgeRefunds pledges;

    public PledgeBackers(PledgeRefunds pledges) {
        this.pledges = pledges;
    }

    /** The backer of each pledge that has one, by pledge. */
    @Transactional(readOnly = true)
    public Map<UUID, UUID> of(Collection<UUID> pledgeIds) {
        Map<UUID, UUID> backers = new HashMap<>();
        for (UUID pledgeId : new LinkedHashSet<>(pledgeIds)) {
            pledges.backerOf(pledgeId).ifPresent(backer -> backers.put(pledgeId, backer));
        }
        return backers;
    }
}
