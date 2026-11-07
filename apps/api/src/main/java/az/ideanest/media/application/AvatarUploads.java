package az.ideanest.media.application;

import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.infrastructure.MediaAssetRepository;
import az.ideanest.user.application.AccountAvatarFiles;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The picture behind an anonymised account's avatar, deleted — {@code user}'s
 * {@link AccountAvatarFiles} (#647).
 *
 * <h2>An address in, an upload out</h2>
 *
 * <p>{@code users.avatar_url} is an address and not a media identifier: the profile took an
 * address before there was anywhere to upload to, and an uploaded picture is saved as the address
 * this module serves it from. So the upload is found from the address, and the match is made
 * strict on purpose, because a wrong match here deletes somebody's file:
 *
 * <ul>
 *   <li>the identifier is read from the address's last segment, which is how
 *       {@link MediaLibrary#derivedKeyOf} names every derived object;
 *   <li>the row must belong to the closing account, so an address copied from another person's
 *       campaign deletes nothing of theirs;
 *   <li>the address this module would serve that row from must be exactly the avatar address,
 *       so a look-alike address on another host deletes nothing either;
 *   <li>and nothing else may still show it ({@link MediaUsage}): an upload the owner also put on
 *       a campaign or a reward stays, because the campaign is not being deleted.
 * </ul>
 *
 * <p>Any other address, a picture hosted elsewhere above all, is simply left alone; this platform
 * never had that file.
 *
 * <h2>Only the avatar</h2>
 *
 * <p>The account's other uploads are not touched, and campaign media above all: campaigns
 * outlive their creator's account. Pictures the person used as an avatar earlier and then
 * replaced are not reached either, because a replaced avatar leaves no reference behind to
 * recognise it by (the profile editor does not delete them, and {@code media} has no column
 * saying what an upload was for).
 */
@Service
public class AvatarUploads implements AccountAvatarFiles {

    private static final Logger log = LoggerFactory.getLogger(AvatarUploads.class);

    private final MediaAssetRepository assets;
    private final ObjectStore store;
    private final MediaLibrary library;
    private final MediaUsage usage;

    public AvatarUploads(MediaAssetRepository assets, ObjectStore store, MediaLibrary library, MediaUsage usage) {
        this.assets = assets;
        this.store = store;
        this.library = library;
        this.usage = usage;
    }

    /**
     * Finds the upload inside the caller's transaction and deletes it after that transaction
     * commits, through {@link MediaLibrary#discardAfterCommit}: the row and every object it has
     * in the store, logged and not retried when the store refuses, and silent when the objects
     * are already gone ({@link ObjectStore#delete} treats an absent key as done).
     */
    @Override
    @Transactional
    public void forgetAfterCommit(UUID userId, String avatarUrl) {
        // A deployment with no storage serves no uploads, so its avatars are all hosted
        // elsewhere -- and its store refuses even to build an address to compare with.
        if (avatarUrl == null || avatarUrl.isBlank() || !store.isAvailable()) {
            return;
        }
        mediaIdIn(avatarUrl)
                .flatMap(mediaId -> assets.findByIdAndOwnerUserId(mediaId, userId))
                .filter(asset -> servedAt(asset, avatarUrl))
                .filter(asset -> {
                    if (usage.isInUse(asset.getId())) {
                        log.info("Media {} was an anonymised account's avatar and is still in use; kept.",
                                asset.getId());
                        return false;
                    }
                    return true;
                })
                .ifPresent(asset -> library.discardAfterCommit(asset.getId()));
    }

    private boolean servedAt(MediaAsset asset, String avatarUrl) {
        return asset.getStorageKey().map(store::publicUrl).filter(avatarUrl::equals).isPresent();
    }

    /**
     * The identifier in {@code .../media/<id>.jpg}, if the last segment of the address starts
     * with one. Anything else is not an address this module minted.
     */
    private static Optional<UUID> mediaIdIn(String address) {
        String segment = address.substring(address.lastIndexOf('/') + 1);
        int dot = segment.indexOf('.');
        String candidate = dot < 0 ? segment : segment.substring(0, dot);
        try {
            return Optional.of(UUID.fromString(candidate));
        } catch (IllegalArgumentException notAnIdentifier) {
            return Optional.empty();
        }
    }
}
