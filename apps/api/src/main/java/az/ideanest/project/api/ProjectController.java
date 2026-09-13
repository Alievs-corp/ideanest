package az.ideanest.project.api;

import az.ideanest.project.application.ProjectChecklistService;
import az.ideanest.project.application.ProjectEditingService;
import az.ideanest.project.application.ProjectTransitionService;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A creator's campaign: creating it, editing it, and moving it through its life.
 *
 * <p>Eight endpoints. Seven answer {@link ProjectEdit}; the eighth is the
 * completeness checklist, which is about the campaign rather than of it. The four
 * that change state do nothing themselves — they name a transition and hand it to
 * {@link ProjectTransitionService}, which is the only thing in the service that
 * writes {@code projects.state} and the only thing that records having done so.
 *
 * <p>The public half of the pre-launch page is deliberately somewhere else:
 * {@code PrelaunchController} serves the page and collects reminders, and it is a
 * separate controller because everything here requires a bearer token and nothing
 * there does.
 *
 * <p>Authorisation is not decided here either. Every method passes the caller's
 * identifier down, and {@code ProjectAccess} decides what that identifier is
 * allowed to reach — one place, so that #38 widening it to collaborators changes
 * one file rather than six methods.
 *
 * <p>The subject of the access token is where the caller comes from, never a path
 * or body parameter. A creator identifier a client could choose would let anybody
 * edit anybody's campaign.
 */
@RestController
@RequestMapping("/v1/projects")
public class ProjectController {

    private final ProjectEditingService editing;
    private final ProjectTransitionService transitions;
    private final ProjectChecklistService checklist;
    private final ProjectEditResponses responses;

    public ProjectController(
            ProjectEditingService editing,
            ProjectTransitionService transitions,
            ProjectChecklistService checklist,
            ProjectEditResponses responses) {
        this.editing = editing;
        this.transitions = transitions;
        this.checklist = checklist;
        this.responses = responses;
    }

    /**
     * Opens a draft.
     *
     * <p>201 with a {@code Location} header pointing at the editor projection: the
     * client's next request is that one, and a created resource should say where it
     * is.
     */
    @PostMapping
    public ResponseEntity<ProjectEdit> create(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody CreateProjectRequest request) {

        ProjectEdit created = responses.of(editing.create(callerOf(accessToken), request.title()));
        return ResponseEntity.created(URI.create("/v1/projects/" + created.id() + "/edit")).body(created);
    }

    /** The campaign as its creator edits it. Anybody else is told it does not exist. */
    @GetMapping("/{id}/edit")
    public ProjectEdit forEdit(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return responses.of(editing.forEdit(id, callerOf(accessToken)));
    }

    /**
     * Applies a partial edit and returns the whole campaign.
     *
     * <p>The whole campaign rather than the fields that changed, because an edit can
     * change a field the client did not send — clearing the subcategory when the
     * category moves — and a client that merged a partial response would keep a
     * value the server has just discarded.
     */
    @PatchMapping("/{id}")
    public ProjectEdit edit(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @RequestBody ProjectPatchRequest request) {

        return responses.of(editing.edit(id, callerOf(accessToken), request.toPatch()));
    }

    /**
     * Opens the campaign's pre-launch page, so it can start collecting followers.
     *
     * <p>{@code POST}, and the same path the public {@code GET} reads — the two
     * live in different controllers because one requires a bearer token and the
     * other must not. Spring routes on the method, and the filter chain permits
     * only the {@code GET}: see {@code SecurityConfiguration}, which draws the same
     * line for {@code /v1/categories}.
     *
     * <p>There is no endpoint that closes the page again. §6.1 has no
     * {@code PRELAUNCH → DRAFT} edge, and adding one would mean a page people have
     * already followed can disappear; a creator who wants to stop is one submission
     * or one cancellation away, both of which are recorded.
     */
    @PostMapping("/{id}/prelaunch")
    public ProjectEdit openPrelaunch(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return responses.of(transitions.openPrelaunch(id, callerOf(accessToken)));
    }

    /**
     * What §5.3 still wants before this campaign can be submitted, and what
     * moderation last said about it.
     *
     * <p>Authorised as the editor's other reads are: anybody who may work on the
     * campaign may see how finished it is. It is a read, and it takes no lock — a
     * checklist is a snapshot of a campaign somebody is still editing, and the
     * answer that matters is the one {@code POST /submit} computes under one.
     *
     * <p><strong>Advice, not enforcement.</strong> A client may ignore this
     * entirely; the submission is checked against the same rules by the same class
     * either way.
     */
    @GetMapping("/{id}/checklist")
    public ProjectChecklist checklist(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return ProjectChecklist.of(checklist.reviewOf(id, callerOf(accessToken)));
    }

    /** Sends the campaign for review. Refused unless §5.3 is satisfied. */
    @PostMapping("/{id}/submit")
    public ProjectEdit submit(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return responses.of(transitions.submit(id, callerOf(accessToken)));
    }

    /** Takes an approved campaign live, now. */
    @PostMapping("/{id}/launch")
    public ProjectEdit launch(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return responses.of(transitions.launch(id, callerOf(accessToken)));
    }

    /**
     * Stops a live campaign. Terminal, and the reason is shown to backers.
     *
     * <p>{@code POST} rather than {@code DELETE}: the campaign is not removed. It
     * keeps its page, its history, and its pledges — which are cancelled rather than
     * charged — and what is created is the cancellation.
     */
    @PostMapping("/{id}/cancel")
    public ProjectEdit cancel(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody CancelProjectRequest request) {

        return responses.of(transitions.cancel(id, callerOf(accessToken), request.reason()));
    }

    /**
     * §4.5's PL-16 and §4.8's PM-23: takes a collected campaign back to accepting
     * pledges, until a date the creator names.
     *
     * <p><strong>Not in §10.2's endpoint list</strong>, and required by #81's
     * definition of done — the same gap {@code openPrelaunch} and {@code requestChanges}
     * have, recorded the same way. §6.1 has had {@code COLLECTING → LATE_PLEDGE} since
     * the state machine was written and nothing performed it, so the state was
     * reachable only by a hand-written {@code UPDATE}. §10.2 is amended in the same
     * change rather than left describing an API that is not the API.
     *
     * <p>{@code POST} to a sub-resource rather than a field on {@code PATCH
     * /v1/projects/{id}}: this moves the campaign's state, and every state change on
     * this platform goes through an endpoint that does nothing else — a state that
     * could be moved by an autosave is a state an autosave will eventually move.
     */
    @PostMapping("/{id}/late-pledges")
    public ProjectEdit openLatePledges(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody OpenLatePledgesRequest request) {

        return responses.of(transitions.openLatePledges(id, callerOf(accessToken), request.endsAt()));
    }

    /**
     * Extends the campaign's deadline, once — IDN-EXT-01 (#34), §5.1.
     *
     * <p>{@code POST} to a sub-resource, for {@code openLatePledges}' reason: it moves the
     * campaign's state, and every state change goes through an endpoint that does nothing else.
     * Refused with {@code EXTENSION_NOT_AVAILABLE} and the reason when the campaign may not be
     * extended now, and with {@code PROJECT_FIELD_INVALID} on {@code until} when the date is
     * outside what §5.1 allows.
     */
    @PostMapping("/{id}/extension")
    public ProjectEdit extend(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody ExtendCampaignRequest request) {

        return responses.of(transitions.extend(id, callerOf(accessToken), request.until()));
    }

    /**
     * IDN-EXT-01 (#41), §5.1: withdraw the funds, which closes the campaign.
     *
     * <p>The creator's alone, at 80% of the goal or above. The payout is requested from the event this
     * records, with its fourteen-day hold, and every backer is told until when they may dispute. 409
     * {@code WITHDRAWAL_NOT_AVAILABLE} with {@code meta.reason} when it cannot be withdrawn now.
     */
    @PostMapping("/{id}/withdrawal")
    public ProjectEdit withdraw(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return responses.of(transitions.withdraw(id, callerOf(accessToken)));
    }

    /**
     * Stops taking late pledges and starts delivering.
     *
     * <p>{@code POST} to {@code /close} rather than {@code DELETE} on the resource
     * above, because nothing is removed: the campaign keeps the record that it offered
     * late pledges and the window it offered them in, and what happens is a transition
     * to {@code FULFILLING}. §6.1 has no edge back — reopening after fulfilment has
     * begun means shipping a second batch of what the creator has already packed.
     */
    @PostMapping("/{id}/late-pledges/close")
    public ProjectEdit closeLatePledges(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return responses.of(transitions.closeLatePledges(id, callerOf(accessToken)));
    }

    /**
     * The account making the request, as our own signature establishes it.
     *
     * <p>Not read from anything the caller could choose.
     */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
