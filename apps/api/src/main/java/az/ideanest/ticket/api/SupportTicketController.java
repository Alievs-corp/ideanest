package az.ideanest.ticket.api;

import az.ideanest.ticket.application.SupportTicketService;
import az.ideanest.ticket.domain.TicketPriority;
import az.ideanest.ticket.domain.TicketSide;
import az.ideanest.ticket.domain.TicketState;
import az.ideanest.ticket.domain.TicketSubjectType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.11's AD-10 over HTTP — issue #310.
 *
 * <h2>Every route here is staff-only, and there is no public one</h2>
 *
 * <p>{@code SupportTicketService.raise} has the argument: a public "contact us" form is a
 * different surface with its own rate limiting, its own spam problem, and an open question
 * about senders who have no account. #310 is the console screen, and what it supports is
 * the workflow the platform has today — somebody writes in, and a member of staff records
 * the conversation against their account so that it carries the context AD-10 is about.
 *
 * <p><strong>{@code no-store}</strong>: a ticket thread is somebody's complaint, and the
 * staff view of it includes notes written about them.
 */
@RestController
@RequestMapping("/v1/admin/tickets")
public class SupportTicketController {

    private final SupportTicketService tickets;

    public SupportTicketController(SupportTicketService tickets) {
        this.tickets = tickets;
    }

    /** The queue: most urgent first, oldest first within a priority. */
    @GetMapping("/queue")
    public ResponseEntity<TicketResponses.TicketPage> queue(
            @AuthenticationPrincipal Jwt accessToken, @RequestParam(defaultValue = "0") int page) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(TicketResponses.TicketPage.of(tickets.queue(callerOf(accessToken), page), page, 50));
    }

    /**
     * Everything, newest first, narrowed by state, priority and who is handling it.
     *
     * <p>The last two arrived with #404: the console displayed all three of these on every
     * row and could filter by none of them, on the screen whose copy explains that staff set
     * the priority.
     *
     * @param state one of §4.11's four, or absent for every state
     * @param priority one of four, or absent for every priority
     * @param assigneeId one member of staff's workload, or absent for anybody's
     * @param unassigned only what nobody has picked up. A separate parameter from
     *     {@code assigneeId} because an absent assignee already means "anybody", and one
     *     value cannot mean both "everybody" and "nobody"
     */
    @GetMapping
    public ResponseEntity<TicketResponses.TicketPage> list(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) TicketState state,
            @RequestParam(required = false) TicketPriority priority,
            @RequestParam(required = false) UUID assigneeId,
            @RequestParam(defaultValue = "false") boolean unassigned,
            @RequestParam(defaultValue = "0") int page) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(TicketResponses.TicketPage.of(
                        tickets.list(callerOf(accessToken), state, priority, assigneeId, unassigned, page),
                        page,
                        50));
    }

    /**
     * One ticket, its thread, and the rest of this person's history.
     *
     * <p>Three things in one response, which is AD-10's "user context" — the service has
     * the argument for why the console should not have to go and look for the history.
     */
    @GetMapping("/{ticketId}")
    public ResponseEntity<TicketResponses.TicketContext> inspect(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID ticketId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(TicketResponses.TicketContext.of(tickets.inspect(callerOf(accessToken), ticketId)));
    }

    /**
     * The thread as the requester would see it.
     *
     * <p>Exists so that somebody about to send a reply can check what the other side
     * actually has in front of them — the staff view interleaves internal notes, and the
     * commonest support mistake is answering a question the requester never saw asked.
     */
    @GetMapping("/{ticketId}/thread")
    public ResponseEntity<TicketResponses.Thread> requesterThread(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID ticketId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(TicketResponses.Thread.of(
                        tickets.thread(callerOf(accessToken), ticketId, TicketSide.REQUESTER)));
    }

    /** Records a conversation against somebody's account. */
    @PostMapping
    public ResponseEntity<TicketResponses.TicketFile> raise(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody RaiseRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(TicketResponses.TicketFile.of(tickets.raise(
                        callerOf(accessToken),
                        request.requesterId(),
                        request.subject(),
                        request.subjectType() == null ? TicketSubjectType.NONE : request.subjectType(),
                        request.subjectRef(),
                        request.priority() == null ? TicketPriority.NORMAL : request.priority(),
                        request.body())));
    }

    /** Answers it, or leaves a note. */
    @PostMapping("/{ticketId}/messages")
    public ResponseEntity<TicketResponses.TicketFile> reply(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID ticketId,
            @Valid @RequestBody ReplyRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(TicketResponses.TicketFile.of(
                        tickets.reply(callerOf(accessToken), ticketId, request.body(), request.internal())));
    }

    /**
     * Changes the assignee, the priority, the state, or any combination.
     *
     * <p>A {@code PATCH} with three optional fields, and here they really are optional —
     * unlike the taxonomy's edit, where both names travel together. These three are
     * independent decisions taken by different people at different moments, and requiring
     * all three would mean somebody reassigning a ticket has to re-send a priority they may
     * have loaded before another person changed it.
     *
     * <p>A null {@code assigneeId} with {@code unassign} true puts it back in the queue.
     * The flag exists because JSON cannot distinguish "absent" from "null" in a record, and
     * silently treating an omitted assignee as an unassignment would empty the queue every
     * time somebody changed a priority.
     */
    @PatchMapping("/{ticketId}")
    public ResponseEntity<TicketResponses.Ticket> update(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID ticketId,
            @Valid @RequestBody UpdateRequest request) {

        UUID caller = callerOf(accessToken);

        if (request.assigneeId() != null || request.unassign()) {
            tickets.assign(caller, ticketId, request.unassign() ? null : request.assigneeId());
        }
        if (request.priority() != null) {
            tickets.prioritise(caller, ticketId, request.priority());
        }

        var ticket = request.state() != null
                ? tickets.moveTo(caller, ticketId, request.state())
                : tickets.inspect(caller, ticketId).file().ticket();

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(TicketResponses.Ticket.of(ticket));
    }

    /**
     * A new ticket.
     *
     * @param requesterId whose conversation it is. May be left out of a ticket about a pledge,
     *     which is then raised for the pledge's backer (#416) — the service has why
     * @param subjectType what it is about. Defaults to {@code NONE} — plenty of tickets are
     *     about nothing in particular, and requiring a subject produces one chosen at
     *     random
     * @param body the opening message, attributed to the requester. The service has why
     */
    public record RaiseRequest(
            UUID requesterId,
            @NotBlank @Size(max = 200) String subject,
            TicketSubjectType subjectType,
            UUID subjectRef,
            TicketPriority priority,
            @NotBlank @Size(max = 20000) String body) {
    }

    /**
     * A reply.
     *
     * @param internal a note staff leave for each other. Never shown to the requester, and
     *     it does not move the ticket — they are still waiting
     */
    public record ReplyRequest(@NotBlank @Size(max = 20000) String body, boolean internal) {
    }

    /** Any of the three things staff change about a ticket without writing on it. */
    public record UpdateRequest(
            UUID assigneeId, boolean unassign, TicketPriority priority, TicketState state) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
