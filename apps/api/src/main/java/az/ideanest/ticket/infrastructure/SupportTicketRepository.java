package az.ideanest.ticket.infrastructure;

import az.ideanest.ticket.domain.SupportTicket;
import az.ideanest.ticket.domain.TicketPriority;
import az.ideanest.ticket.domain.TicketState;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * V51's tickets — issue #310.
 *
 * <p>The queue is ordered by priority and then by age. Both, and in that order: age alone
 * makes an urgent ticket wait behind a week of questions, and priority alone lets a normal
 * one sit for a month because there is always another normal one.
 */
public interface SupportTicketRepository extends JpaRepository<SupportTicket, UUID> {

    /**
     * The queue: everything still somebody's work, most urgent first.
     *
     * <p><strong>The rank is spelled out, because the column is text.</strong> This sorted
     * by {@code t.priority DESC} on the belief that it compared the enum's ordinal, and
     * {@code SupportTicket} maps the priority with {@code EnumType.STRING} onto V51's
     * {@code text} column — so it compared the names, and the queue read URGENT, NORMAL,
     * LOW, HIGH. A ticket marked high was the last thing anybody working from the front
     * would reach.
     */
    @Query(
            """
            SELECT t FROM SupportTicket t
            WHERE t.state IN (
                az.ideanest.ticket.domain.TicketState.OPEN,
                az.ideanest.ticket.domain.TicketState.PENDING)
            ORDER BY
                CASE t.priority
                    WHEN az.ideanest.ticket.domain.TicketPriority.URGENT THEN 0
                    WHEN az.ideanest.ticket.domain.TicketPriority.HIGH THEN 1
                    WHEN az.ideanest.ticket.domain.TicketPriority.NORMAL THEN 2
                    ELSE 3
                END,
                t.createdAt ASC
            """)
    List<SupportTicket> queue(Pageable pageable);

    /**
     * Everything, newest first, narrowed by any combination of three filters — #404.
     *
     * <p>One query with nullable parameters, where this file used to hold two: {@code page}
     * and {@code pageByState}, and a comment saying "two queries rather than a nullable
     * parameter". That was right when there was one filter and became untenable at three —
     * eight methods for one question — and the reason it costs nothing here is the table.
     * {@code audit_logs} and {@code transactions} get spelled-out variants because a filter
     * outside their indexes is a scan over the largest tables the platform holds;
     * {@code support_tickets} holds one row per support conversation, V51 indexes the open
     * queue and the requester, and a plan that reads all of them is a plan that reads a few
     * hundred rows.
     *
     * <p>{@code :assigneeId IS NULL OR …} is the form {@code UserRepository.search} has used
     * since #104, and is safe for the same reason: each parameter also appears in a
     * comparison against a typed path, so Hibernate infers its type rather than guessing.
     *
     * @param unassigned the queue, in the sense staff mean it — a ticket nobody has picked
     *     up. Its own parameter rather than a null {@code assigneeId}, because null there
     *     already means "any assignee", and one value cannot mean both "everybody" and
     *     "nobody"
     */
    @Query(
            """
            SELECT t FROM SupportTicket t
            WHERE (:state IS NULL OR t.state = :state)
              AND (:priority IS NULL OR t.priority = :priority)
              AND (:assigneeId IS NULL OR t.assigneeId = :assigneeId)
              AND (:unassigned = FALSE OR t.assigneeId IS NULL)
            ORDER BY t.createdAt DESC
            """)
    List<SupportTicket> filtered(
            @Param("state") TicketState state,
            @Param("priority") TicketPriority priority,
            @Param("assigneeId") UUID assigneeId,
            @Param("unassigned") boolean unassigned,
            Pageable pageable);

    /**
     * What this person has asked us before.
     *
     * <p>§4.11's "user context": the ticket in front of somebody is read alongside every
     * other one the same account has raised, because the fifth complaint from one person is
     * a different conversation from the first.
     */
    @Query("SELECT t FROM SupportTicket t WHERE t.requesterId = :requesterId ORDER BY t.createdAt DESC")
    List<SupportTicket> forRequester(@Param("requesterId") UUID requesterId);

    /** One person's workload, for the console's own list. */
    @Query(
            """
            SELECT t FROM SupportTicket t
            WHERE t.assigneeId = :assigneeId
            ORDER BY t.priority DESC, t.createdAt ASC
            """)
    List<SupportTicket> assignedTo(@Param("assigneeId") UUID assigneeId);
}
