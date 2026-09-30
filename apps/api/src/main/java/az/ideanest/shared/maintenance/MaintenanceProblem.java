package az.ideanest.shared.maintenance;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * The maintenance response body — the contract of issue #214.
 *
 * <p>An RFC 9457 problem document with a fixed {@code type}, and deliberately
 * <strong>no {@code detail}</strong>: the body carries no prose for readers. A client
 * renders its own catalogue copy from {@code type}, {@code source} and the two instants,
 * so the page is in the reader's language — a sentence written here would be in English
 * on every screen.
 *
 * <p>Written as a record rather than a {@code ProblemDetail} so that both producers
 * serialise exactly these six fields and nothing else. {@code ProblemDetail} would add
 * {@code instance} on one path and not the other, and would drop {@code endsAt} when it
 * is null under this service's {@code non_null} default — and a missing key and a null
 * one mean different things here: null is "until further notice".
 *
 * @param source {@code api} from this service; {@code edge} is the same body served by
 *     the proxy when this service is not running at all
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
@JsonPropertyOrder({"type", "title", "status", "startsAt", "endsAt", "source"})
@Schema(description = "The maintenance problem (issue #214). Any other 5xx, including a 503 without this"
        + " `type`, is an ordinary failure.")
public record MaintenanceProblem(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = TYPE) String type,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = TITLE) String title,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = "503") int status,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant startsAt,
        @Schema(description = "Null when no end is announced.", types = {"string", "null"}, format = "date-time")
                Instant endsAt,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {SOURCE_API, "edge"})
                String source) {

    public static final String TYPE = "https://ideanest.az/problems/maintenance";

    public static final String TITLE = "Scheduled maintenance";

    public static final String SOURCE_API = "api";

    /** The content type of every problem document. */
    public static final MediaType MEDIA_TYPE = MediaType.APPLICATION_PROBLEM_JSON;

    public static MaintenanceProblem of(ActiveMaintenance window) {
        return new MaintenanceProblem(
                TYPE,
                TITLE,
                HttpStatus.SERVICE_UNAVAILABLE.value(),
                window.startsAt(),
                window.endsAt(),
                SOURCE_API);
    }

    /** The whole response: 503, {@code Retry-After}, {@code no-store}, and this body. */
    public static ResponseEntity<MaintenanceProblem> response(ActiveMaintenance window, long retryAfterSeconds) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds))
                .cacheControl(CacheControl.noStore())
                .contentType(MEDIA_TYPE)
                .body(of(window));
    }
}
