package az.ideanest.user.application;

import java.util.UUID;

/**
 * What this module needs from whoever keeps uploaded files, when an account is anonymised (#647)
 * and when its owner replaces or removes the profile picture (#649).
 *
 * <p><strong>Why anonymisation has to ask.</strong> {@code User.anonymise} clears
 * {@code avatar_url}, and until #647 that was all: the picture itself stayed in object storage
 * under its public address, with its {@code media} row naming this account as its owner. Clearing
 * the column unlinks the photograph from the profile; it does not delete a photograph of somebody
 * who has asked to be forgotten, and anybody who kept the address could still fetch it.
 *
 * <p><strong>The profile editor had the same gap</strong> (#649). A new picture, or none,
 * overwrote {@code avatar_url} and left the previous upload in the store under its public
 * address for good: the person had taken the photograph off their profile, and it was still
 * there for anybody who had the link. Once the column moves on, nothing points at the old upload
 * any more, so it can never be recognised as an avatar again; the editor is the last moment
 * anything knows what it was.
 *
 * <p><strong>An interface here, implemented over there</strong>, for {@link AccountSecurity}'s
 * reason. The files and their rows belong to {@code media}. This module depends on nothing but
 * {@code audit}, {@code fx} and {@code shared}, and every other module depends on it, so the call
 * goes through a port this module owns and {@code media} implements, rather than through an edge
 * that would make the leaf of the graph depend on a feature module.
 */
public interface AccountAvatarFiles {

    /**
     * Deletes the uploaded picture behind this avatar address, once the caller's transaction has
     * committed.
     *
     * <p><strong>After the commit, not during it</strong>: an object store is not part of the
     * transaction, and deleting the file inside an anonymisation that then rolled back would leave
     * a still-existing account pointing at a picture that is gone. The other failure, a commit
     * followed by a deletion that did not happen, leaves an orphaned file, so it is logged rather
     * than retried, and a file that is already gone is not a failure at all.
     *
     * <p><strong>Only that one upload.</strong> Nothing is done for a null address, for an address
     * that is not one of this platform's uploads (the profile also takes a picture hosted
     * elsewhere), for an upload owned by another account, or for one a campaign or reward still
     * shows. Other uploads the account owns, campaign media above all, are not touched.
     *
     * @param avatarUrl the address as it stood before anonymisation cleared it, or null
     */
    void forgetAfterCommit(UUID userId, String avatarUrl);

    /**
     * {@link #forgetAfterCommit}, for an avatar its owner has just replaced or removed (#649).
     *
     * <p>The same rules, and one more: the upload the profile shows <em>now</em> is never
     * deleted, even when it is the same upload under a differently written address. Saving the
     * picture the profile already has deletes nothing.
     *
     * @param previousUrl the address the profile showed before this edit, or null
     * @param currentUrl the address it shows after it, or null when the picture was removed
     */
    void forgetReplacedAfterCommit(UUID userId, String previousUrl, String currentUrl);
}
