package az.ideanest.notification.infrastructure;

import az.ideanest.notification.domain.NotificationCategory;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationPreference;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Standing instructions, by the two questions asked of them.
 *
 * <p>Both reads are "everything this person has said", never "everything anybody has
 * said about this category": the fan-out resolves one recipient at a time, and a query
 * that could answer the other question would be the beginning of a report about what
 * people have switched off.
 */
public interface NotificationPreferenceRepository extends JpaRepository<NotificationPreference, UUID> {

    /**
     * Everything this person has expressed.
     *
     * <p>Usually empty, and that is not a degenerate case — it is the common one. A
     * user who has never opened the settings page has no rows at all, and
     * {@code DeliveryPolicy} is what turns that absence into an answer.
     *
     * <p>One query for the whole account rather than one per (category, channel): the
     * fan-out needs at most twenty-one rows and a campaign event resolves several
     * channels at once, so twenty-one round trips would buy nothing.
     */
    List<NotificationPreference> findByUserId(UUID userId);

    /** The one instruction a change replaces, if it exists. */
    Optional<NotificationPreference> findByUserIdAndCategoryAndChannel(
            UUID userId, NotificationCategory category, NotificationChannel channel);

    /**
     * Everything an account has said — its anonymisation (#647). Bulk, and without
     * {@code clearAutomatically}, for {@link NotificationRepository#deleteByRecipientId}'s reason.
     */
    @Modifying
    @Query("delete from NotificationPreference preference where preference.userId = :userId")
    int deleteByUserId(@Param("userId") UUID userId);
}
