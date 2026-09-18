package az.ideanest.discovery.api;

import az.ideanest.discovery.application.CollectionNotFoundException;
import az.ideanest.discovery.application.CollectionSlugTakenException;
import az.ideanest.discovery.application.CurationRejectedException;
import az.ideanest.discovery.application.RankingRejectedException;
import az.ideanest.discovery.application.UnknownFilterValueException;
import az.ideanest.discovery.application.UnsupportedDiscoveryOptionException;
import az.ideanest.discovery.domain.DiscoveryCapability;
import az.ideanest.discovery.domain.InvalidCursorException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Discovery's own failures, as RFC 9457 problem details (§10.4).
 *
 * <p>Scoped to this module's controllers rather than applied globally, for the reason
 * {@code RewardExceptionHandler} gives: an advice that catches a broad type across the
 * whole service turns a bug somewhere else into a tidy 4xx and hides it. Both of them
 * are named, because {@code /v1/search} raises exactly the same three failures as
 * {@code /v1/discover} — it binds the same parameters and issues the same query — and
 * an advice that covered one would leave the other answering a bad cursor with a 500.
 *
 * <p>Every response carries a {@code code} as well as a status. All three failures
 * here are 400s and a client has to be able to tell them apart without matching on
 * prose — one means "start again from the first page", one means "stop sending this
 * parameter", and one means "fix the value".
 */
@RestControllerAdvice(
        assignableTypes = {
            DiscoveryController.class,
            SearchController.class,
            // The collection endpoints raise two of the three above unchanged — a
            // malformed cursor and a limit that is not a number — because they page
            // with the same tokens and clamp with the same bounds. Listing them here
            // rather than writing a second advice keeps one refusal to one body; the
            // curation failures below are new and are named individually.
            CollectionController.class,
            AdminCurationController.class,
            // #44's admin surface raises the moderator refusal unchanged and adds one
            // failure of its own. Listed here rather than given a second advice for the
            // reason the collection endpoints are: one refusal, one body.
            AdminRankingController.class
        })
public class DiscoveryExceptionHandler {

    /**
     * 400 for a query that asks for something no implementation can do yet.
     *
     * <p>Not 501, which would tell a client the service is incomplete and to try
     * another instance: every instance answers this the same way, and the request is
     * the thing that has to change. Not 200 with the option ignored, which is the
     * failure this exists to prevent.
     *
     * <p>{@code meta.unsupported} names the parameter and the issue that owns it, so
     * that a client developer is sent to the issue rather than to the source.
     */
    @ExceptionHandler(UnsupportedDiscoveryOptionException.class)
    public ProblemDetail handleUnsupported(UnsupportedDiscoveryOptionException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/discovery-option-unsupported"));
        problem.setTitle("Not available yet");
        problem.setDetail("This request asks for a discovery option that is not implemented yet.");
        problem.setProperty("code", "DISCOVERY_OPTION_UNSUPPORTED");

        List<Map<String, String>> unsupported = new ArrayList<>();
        for (DiscoveryCapability capability : exception.missing()) {
            Map<String, String> entry = new LinkedHashMap<>();
            entry.put("parameter", capability.parameter());
            entry.put("needs", capability.owner());
            unsupported.add(entry);
        }
        problem.setProperty("meta", Map.of("unsupported", unsupported));
        return problem;
    }

    /**
     * 400 for a cursor that does not belong here.
     *
     * <p>Two codes, because a client fixes them differently.
     * {@code DISCOVERY_CURSOR_MISMATCH} means the filters or the sort changed while a
     * cursor was kept, and the fix is to drop the cursor when the query changes.
     * {@code DISCOVERY_CURSOR_INVALID} means the token is not one this service issued,
     * and the fix is to start from the first page.
     *
     * <p>Refused rather than tolerated. Ignoring a stale cursor and answering with
     * page one silently restarts an infinite scroll from the top; the client reads
     * that as "there is more" and appends, and the reader sees every card twice with
     * nothing anywhere reporting a problem.
     */
    @ExceptionHandler(InvalidCursorException.class)
    public ProblemDetail handleInvalidCursor(InvalidCursorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create(exception.isMismatch()
                ? "https://ideanest.az/problems/discovery-cursor-mismatch"
                : "https://ideanest.az/problems/discovery-cursor-invalid"));
        problem.setTitle(exception.isMismatch() ? "Cursor does not match this query" : "Invalid cursor");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", exception.isMismatch() ? "DISCOVERY_CURSOR_MISMATCH" : "DISCOVERY_CURSOR_INVALID");
        return problem;
    }

    /**
     * 400 for a value that is not one of the values a filter takes.
     *
     * <p>{@code meta.allowed} carries the whole vocabulary, so the fix is in the
     * response rather than in documentation the caller has to go and find. A slug that
     * names nothing is deliberately not this error — see
     * {@link UnknownFilterValueException}.
     */
    @ExceptionHandler(UnknownFilterValueException.class)
    public ProblemDetail handleUnknownValue(UnknownFilterValueException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/discovery-value-unknown"));
        problem.setTitle("Unknown filter value");
        problem.setDetail("'" + exception.value() + "' is not a value that " + exception.parameter() + " takes.");
        problem.setProperty("code", "DISCOVERY_VALUE_UNKNOWN");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("parameter", exception.parameter());
        meta.put("value", exception.value());
        meta.put("allowed", exception.allowed());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 404 for a collection this caller may not see.
     *
     * <p>The same answer for "there is no such collection", "it is not published yet",
     * and "its window has closed", deliberately. See {@link CollectionNotFoundException}
     * — a 403 would confirm that a list somebody is still assembling exists, which is
     * the same confidentiality a draft campaign's 404 protects.
     */
    @ExceptionHandler(CollectionNotFoundException.class)
    public ProblemDetail handleCollectionNotFound(CollectionNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/collection-not-found"));
        problem.setTitle("No such collection");
        // Deliberately not the exception's message, which names the slug that was
        // asked for and would echo it back into the body.
        problem.setDetail("That collection does not exist.");
        problem.setProperty("code", "COLLECTION_NOT_FOUND");
        return problem;
    }

    /**
     * 403 for a signed-in caller who is not platform staff.
     *
     * <p>The same shape the project module answers with, because it is the same
     * refusal and the same configured list behind it — a client that already handles
     * {@code NOT_A_MODERATOR} from the moderation queue must not have to learn a second
     * code for the same fact. The body is duplicated rather than shared because the two
     * advices are scoped to their own controllers on purpose: an advice that caught a
     * broad type across the service would turn a bug somewhere else into a tidy 4xx.
     */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotAModerator(NotAModeratorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-moderator"));
        problem.setTitle("Not a moderator");
        problem.setDetail("Curating and tuning the ranking are moderator actions.");
        problem.setProperty("code", "NOT_A_MODERATOR");
        return problem;
    }

    /**
     * 403 for a colleague on a surface that is not theirs.
     *
     * <p>A different refusal from the one above and deliberately not collapsed into it: that
     * one says "you do not work here", this one names the capability the caller is short of,
     * and only the second can be fixed by asking an administrator for a role. The console
     * reads {@code meta.capability} off this body and says which — and it is what the rail
     * hides an entry on, so the two agree about collections, badges, open calls and placement, which are {@code StaffRole.CURATOR}'s.
     */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /** 400 for a curation request that names a field the platform will not accept. */
    @ExceptionHandler(CurationRejectedException.class)
    public ProblemDetail handleCurationRejected(CurationRejectedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/curation-rejected"));
        problem.setTitle("That change was refused");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "CURATION_REJECTED");
        problem.setProperty("meta", Map.of("field", exception.field()));
        return problem;
    }

    /**
     * 400 for a ranking change the platform will not make.
     *
     * <p>A code of its own rather than {@code CURATION_REJECTED}: a client that handles
     * one should not silently start receiving the other under it, and the two are raised
     * by different screens for different reasons. {@code meta.field} names the input to
     * fix — most often {@code active}, for a term nothing computes yet.
     */
    @ExceptionHandler(RankingRejectedException.class)
    public ProblemDetail handleRankingRejected(RankingRejectedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/ranking-rejected"));
        problem.setTitle("That change was refused");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "RANKING_REJECTED");
        problem.setProperty("meta", Map.of("field", exception.field()));
        return problem;
    }

    /**
     * 409 for a slug another collection already answers at.
     *
     * <p>Not a 400: nothing about the request is malformed, and what stops it is the
     * state of the platform rather than the shape of the input — which is what tells a
     * client to retry with a different slug rather than not to retry at all.
     */
    @ExceptionHandler(CollectionSlugTakenException.class)
    public ProblemDetail handleSlugTaken(CollectionSlugTakenException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/collection-slug-taken"));
        problem.setTitle("That slug is taken");
        problem.setDetail("Another collection already answers at that address.");
        problem.setProperty("code", "COLLECTION_SLUG_TAKEN");
        problem.setProperty("meta", Map.of("slug", exception.slug()));
        return problem;
    }
}
