package az.ideanest.community.application;

import az.ideanest.community.domain.Comment;
import az.ideanest.pledge.application.PublicBackers;
import az.ideanest.user.application.PublicName;
import az.ideanest.user.application.PublicProfiles;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Who wrote a comment, as a stranger may be told — #255.
 *
 * <p><strong>A missing field, not a decision.</strong> {@code CommentResponse} carried the
 * author's identifier and no name, and said why: the name was "the profile endpoint's to
 * serve", because a body carrying names needs a join per row and a rule for what a deleted
 * account is called. Nothing in §4.9 asks for anonymous comments, and a Comments tab where
 * nobody has a name is not one a reader can follow. This is that join, done once per page,
 * and these are the rules.
 *
 * <p><strong>A name is drawn only when nothing the author chose withholds it.</strong> In
 * every other case there is no name, and the client draws the same neutral "Member" for all of
 * them, so a reader cannot tell which case it was:
 *
 * <ul>
 *   <li>a profile its owner made private (§4.2's P-07) — {@link PublicProfiles#publicNames}
 *       applies the profile page's own rule, so the setting holds on both surfaces;
 *   <li>an author who backed this campaign anonymously (§4.5's PL-12) — by §3.1 the people
 *       commenting on a campaign are its backers, so a name under a comment says "this person
 *       backed it" as plainly as a backer list would;
 *   <li>an account §17.4 has closed, which has no public name left to show;
 *   <li>a removed comment, whose author {@code CommentResponse} already withholds.
 * </ul>
 *
 * <p>When a rule is in doubt the answer is no name. A comment without one loses a little
 * context; a name a person asked to keep off the page cannot be taken back once it is read.
 */
@Service
public class CommentAuthors {

    private final PublicProfiles profiles;
    private final PublicBackers backers;

    public CommentAuthors(PublicProfiles profiles, PublicBackers backers) {
        this.profiles = profiles;
        this.backers = backers;
    }

    /**
     * The names to draw beside these comments on one campaign, by author.
     *
     * @return the authors that may be named; an author absent from it is drawn without one
     */
    @Transactional(readOnly = true)
    public Map<UUID, PublicName> on(UUID projectId, Collection<Comment> comments) {
        Set<UUID> authors = new HashSet<>();
        for (Comment comment : comments) {
            if (!comment.isDeleted() && comment.getAuthorId() != null) {
                authors.add(comment.getAuthorId());
            }
        }
        if (authors.isEmpty()) {
            return Map.of();
        }

        Map<UUID, PublicName> names = new HashMap<>(profiles.publicNames(authors));
        names.keySet().removeAll(backers.anonymousBackersAmong(projectId, authors));
        return Map.copyOf(names);
    }
}
