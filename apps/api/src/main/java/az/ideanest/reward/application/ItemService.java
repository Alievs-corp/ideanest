package az.ideanest.reward.application;

import az.ideanest.project.application.CatalogueWriting;
import az.ideanest.project.application.EditLocks;
import az.ideanest.project.application.ProjectRevisionService;
import az.ideanest.reward.domain.Item;
import az.ideanest.reward.domain.RewardTierItem;
import az.ideanest.reward.infrastructure.ItemRepository;
import az.ideanest.reward.infrastructure.RewardTierItemRepository;
import az.ideanest.shared.HttpsAddresses;
import jakarta.persistence.EntityManager;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The atomic units a campaign produces: writing them down, correcting them, and
 * removing the ones that turned out not to exist.
 *
 * <p><strong>Validation is here as well as in the database.</strong> Every rule
 * below is also a check constraint in {@code V7}. The constraint holds against a
 * support query, an import, and a code path nobody has written yet; this is what
 * turns the same rule into a 400 naming the field, because a constraint violation
 * reaches the client as a 500 and tells them nothing they can act on.
 *
 * <h2>On a launched campaign, a public item's edit waits for a moderator (#587)</h2>
 *
 * <p>This class used to argue that an item is bookkeeping and that correcting one after
 * launch changes nothing a backer was promised. Half of that was wrong: an item's name,
 * description and picture are what a backer reads inside the tier they chose, and its weight
 * and whether it ships are what a quote charges for. So once the public has seen the
 * campaign, an edit to an item an approved tier contains is staged in the campaign's open
 * revision, as a tier's is, and the row keeps what the public sees until a moderator approves
 * it; the creator's reads show the staged state and name the held fields. Not the stock code,
 * which is the creator's own and nobody else reads, and not an item no approved tier contains,
 * which the public has not seen. Creating one is not held either: it reaches the public only
 * through a tier's composition, and that change is held with the tier.
 */
@Service
public class ItemService {

    /** Also {@code items_name_length}. Long enough for "Hardcover, signed by the illustrator". */
    private static final int NAME_MAX = 120;

    /** Also {@code items_sku_length}. A warehouse code, not a description. */
    private static final int SKU_MAX = 64;

    private final ItemRepository items;
    private final RewardTierItemRepository compositions;
    private final RewardAccess access;
    private final ProjectRevisionService revisions;
    private final EntityManager entityManager;

    public ItemService(
            ItemRepository items,
            RewardTierItemRepository compositions,
            RewardAccess access,
            ProjectRevisionService revisions,
            EntityManager entityManager) {
        this.items = items;
        this.compositions = compositions;
        this.access = access;
        this.revisions = revisions;
        this.entityManager = entityManager;
    }

    /**
     * Every item of the campaign, for its creator, with what waits for a moderator written on.
     * Anybody else is told the campaign does not exist.
     */
    @Transactional(readOnly = true)
    public List<ItemDetail> list(UUID projectId, UUID accountId) {
        EditLocks locks = access.requireEditableProject(projectId, accountId);
        Map<UUID, CatalogueWriting.Item> held =
                locks.rewardWritingHeld() ? revisions.heldItems(projectId) : Map.of();
        return items.findByProjectIdOrderByCreatedAtAsc(projectId).stream()
                .map(item -> ItemDetail.of(item, held.get(item.getId())))
                .toList();
    }

    @Transactional
    public Item create(UUID projectId, UUID accountId, NewItem draft) {
        access.requireEditableProject(projectId, accountId);

        Item item = Item.of(projectId, requireName(draft.name()));
        item.setDescription(blankAsNull(draft.description()));
        item.setImageUrl(httpsOrNull(draft.imageUrl()));
        item.setSku(uniqueSku(projectId, null, draft.sku()));
        applyPhysicality(item, draft.digital(), draft.weightGrams());

        return items.save(item);
    }

    /**
     * Applies a partial edit: to the row, or on a launched campaign for an item the public
     * sees, to its proposed state in the campaign's open revision (#587, see the class comment).
     *
     * <p>Field by field, and only the fields the client mentioned — except for the
     * two that describe what the item physically is, which move together because the
     * database refuses a digital item with a weight.
     */
    @Transactional
    public ItemDetail edit(UUID itemId, UUID accountId, ItemPatch patch) {
        RewardAccess.AuthorisedItem authorised = access.requireEditableItemWithLocks(itemId, accountId);
        Item item = authorised.item();
        boolean held = authorised.locks().rewardWritingHeld();

        if (held) {
            // Whether the public sees this item is what a moderator's approval of the revision
            // changes, and the approval locks the campaign. So the campaign is locked before that
            // is asked and the row read again after, rather than both coming from before the lock:
            // an approval landing in between sent the edit of an item it had just made public
            // straight to the row, or the edit of one it had just taken out of every tier to
            // stageItem, which has nothing public to stage against and answered 500. The refresh is
            // also what keeps the stock code below from writing the row back over the approval.
            revisions.lockCampaign(item.getProjectId());
            entityManager.refresh(item);
        }

        // The stock code is the creator's own bookkeeping, and is written at once either way.
        patch.sku().ifPresent(sku -> item.setSku(uniqueSku(item.getProjectId(), itemId, sku)));

        if (held && items.isInAnApprovedTier(itemId)) {
            CatalogueWriting.Item staged =
                    revisions.stageItem(item.getProjectId(), itemId, accountId, before -> applied(before, patch));
            return ItemDetail.of(item, staged);
        }

        RewardTierWritings.writeOnto(item, applied(RewardTierWritings.writingOf(item), patch));
        return ItemDetail.of(item, null);
    }

    /** {@code before} with the patch applied, every field checked. */
    private static CatalogueWriting.Item applied(CatalogueWriting.Item before, ItemPatch patch) {
        String name = patch.name().isPresent() ? requireName(patch.name().value()) : before.name();
        String description =
                patch.description().isPresent() ? blankAsNull(patch.description().value()) : before.description();
        String imageUrl = patch.imageUrl().isPresent() ? httpsOrNull(patch.imageUrl().value()) : before.imageUrl();

        boolean digital = before.digital();
        Integer weight = before.weightGrams();
        if (patch.changesPhysicality()) {
            digital = patch.digital().isPresent() ? requireBoolean("digital", patch.digital().value()) : digital;
            weight = patch.weightGrams().isPresent() ? patch.weightGrams().value() : weight;
            requirePhysicality(digital, weight);
        }
        return new CatalogueWriting.Item(name, description, imageUrl, digital, weight);
    }

    /**
     * Removes an item, unless a reward tier contains it.
     *
     * <p>Refused rather than cascaded. Removing the item from every tier that
     * included it would change what a backer was promised, in a request that reads as
     * housekeeping; naming the tiers means the creator takes it out of each one
     * deliberately. The foreign key refuses the same delete, which is what holds when
     * this check is not the code doing the deleting.
     */
    @Transactional
    public void delete(UUID itemId, UUID accountId) {
        Item item = access.requireEditableItem(itemId, accountId);

        List<UUID> usedBy = compositions.findByItem(itemId).stream()
                .map(RewardTierItem::getRewardTierId)
                .toList();
        if (!usedBy.isEmpty()) {
            throw new ItemInUseException(itemId, usedBy);
        }

        items.delete(item);
    }

    private static String requireName(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty()) {
            // Not clearable: the column is NOT NULL, and an item with no name cannot
            // be listed in the tier editor or totalled in a fulfilment report. A
            // client sending null here is trying to clear a required field, which is
            // a different mistake from omitting it.
            throw new RewardFieldRejectedException("name", "An item needs a name.");
        }
        if (trimmed.length() > NAME_MAX) {
            throw new RewardFieldRejectedException("name", "That is longer than " + NAME_MAX + " characters.");
        }
        return trimmed;
    }

    /**
     * The code, if nothing else in the campaign is already using it.
     *
     * @param itemId the item being edited, or null when one is being created. Passed
     *     so that saving a form without changing the code is not a collision with
     *     itself
     */
    private String uniqueSku(UUID projectId, UUID itemId, String sku) {
        String normalised = blankAsNull(sku);
        if (normalised == null) {
            return null;
        }
        if (normalised.length() > SKU_MAX) {
            throw new RewardFieldRejectedException("sku", "A stock code is at most " + SKU_MAX + " characters.");
        }

        Optional<Item> existing = items.findByProjectIdAndSku(projectId, normalised);
        if (existing.isPresent() && !existing.get().getId().equals(itemId)) {
            throw new RewardFieldRejectedException(
                    "sku", "Another item in this campaign already uses that stock code.");
        }
        return normalised;
    }

    /**
     * What the item is, and what it weighs.
     *
     * <p>The entity refuses the impossible combination with an
     * {@link IllegalArgumentException}, which is right for a caller that has no user
     * to answer; here there is one, and they get the field name.
     */
    private static void applyPhysicality(Item item, boolean digital, Integer weightGrams) {
        requirePhysicality(digital, weightGrams);
        item.describePhysicality(digital, weightGrams);
    }

    /** {@link #applyPhysicality}'s checks, for a state that is not written to a row yet. */
    private static void requirePhysicality(boolean digital, Integer weightGrams) {
        if (weightGrams != null && weightGrams <= 0) {
            throw new RewardFieldRejectedException("weightGrams", "A weight is more than zero grams.");
        }
        if (digital && weightGrams != null) {
            throw new RewardFieldRejectedException(
                    "weightGrams", "A digital item has no shipping weight. Clear the weight, or make it physical.");
        }
    }

    /**
     * Treats an empty string as an absent value.
     *
     * <p>A creator who empties a text input sends {@code ""}, not {@code null}. The
     * database refuses a blank description — a zero-length string is not a
     * description — and answering an autosave with a 400 for clearing a field is a
     * worse experience than storing what the creator plainly meant.
     */
    /**
     * An item's typed image address, https only (#587): it is rendered on the campaign page
     * beside the cover, so it needs the cover's rule, {@link HttpsAddresses}.
     */
    private static String httpsOrNull(String value) {
        String address = blankAsNull(value);
        if (address != null && !HttpsAddresses.isHttps(address)) {
            throw new RewardFieldRejectedException("imageUrl", "An image address has to start with https:// and hold no spaces.");
        }
        return address;
    }

    private static String blankAsNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static boolean requireBoolean(String field, Boolean value) {
        if (value == null) {
            throw new RewardFieldRejectedException(field, "That setting is either on or off.");
        }
        return value;
    }
}
