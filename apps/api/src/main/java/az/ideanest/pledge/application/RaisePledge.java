package az.ideanest.pledge.application;

import az.ideanest.shared.Patched;
import az.ideanest.shared.money.Money;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * #171: a backer raising a paid pledge while its campaign takes pledges.
 *
 * <p>The selection fields are PL-09's, with its Merge-Patch meaning: absent keeps what the pledge
 * has, and {@code rewardTierId: null} gives up the reward. There is no anonymity flag and no card: a
 * raise changes what is bought.
 *
 * @param expectedAmount the difference the backer was shown and agreed to pay
 */
public record RaisePledge(
        UUID pledgeId,
        UUID backerId,
        Patched<UUID> rewardTierId,
        Patched<List<DraftPledge.AddonSelection>> addons,
        Patched<Money> contribution,
        Patched<String> shippingCountry,
        Money expectedAmount) {

    public RaisePledge {
        Objects.requireNonNull(pledgeId, "A raise names the pledge it raises");
        Objects.requireNonNull(backerId, "A raise is made by somebody");
        Objects.requireNonNull(expectedAmount, "A raise says what the backer agreed to pay");
        rewardTierId = Patched.orAbsent(rewardTierId);
        addons = Patched.orAbsent(addons);
        contribution = Patched.orAbsent(contribution);
        shippingCountry = Patched.orAbsent(shippingCountry);
        if (contribution.isPresent() && contribution.value() == null) {
            throw new IllegalArgumentException("A pledge is an amount somebody chose to give");
        }
        if (!expectedAmount.isPositive()) {
            throw new IllegalArgumentException("A raise charges something");
        }
    }

    /** The selection half, as PL-09's edit takes it. */
    EditPledge asEdit() {
        return new EditPledge(
                pledgeId,
                backerId,
                rewardTierId,
                addons,
                contribution,
                shippingCountry,
                Patched.absent(),
                Patched.absent());
    }
}
