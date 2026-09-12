package az.ideanest.subscription.application;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.UUID;

/**
 * Where one page of the payment list ended — #23.
 *
 * <p>{@code AuditCursor}'s shape and its whole argument, on a different table: the list is
 * ordered by {@code (received_at DESC, id DESC)}, so a cursor is that pair. Its own type
 * rather than a reuse of the audit module's, because the two encode different columns and
 * a shared type would be a promise that they always will.
 *
 * <p><strong>Both halves, because the tie is the normal case here.</strong> On the audit
 * trail two rows share an instant when one transaction writes both. On this table they
 * share one routinely: {@code received_at} is a date somebody typed, so a morning spent
 * entering last month's transfers produces a dozen rows on the same day — and a cursor
 * carrying only the instant would skip all but one of them, or serve them again.
 *
 * <p>Opaque for {@code AuditCursor}'s reason, which is not secrecy — anybody can decode
 * base64. What it buys is that no client is tempted to construct one, because the moment a
 * client builds cursors the ordering columns become part of the API contract and can no
 * longer be changed.
 */
public record PaymentCursor(Instant at, UUID id) {

    private static final String SEPARATOR = ":";

    public PaymentCursor {
        if (at == null || id == null) {
            throw new IllegalArgumentException("A cursor is an instant and an identifier");
        }
    }

    /** The opaque form a client is handed and hands back. */
    public String encode() {
        String plain = at + SEPARATOR + id;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(plain.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * A cursor a client handed back, or null when it handed back nothing.
     *
     * <p>The split is on the <em>last</em> separator: an ISO-8601 instant contains colons
     * of its own and a UUID contains none.
     *
     * @throws InvalidPaymentCursorException for anything this endpoint did not issue. One
     *     answer for every way it can be wrong, because the client's next move is the same
     *     in all of them — start the list again — and naming which half failed would tell
     *     whoever is probing how the value is built
     */
    public static PaymentCursor decode(String encoded) {
        if (encoded == null || encoded.isBlank()) {
            return null;
        }
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
            int separator = decoded.lastIndexOf(SEPARATOR);
            if (separator < 0) {
                throw new InvalidPaymentCursorException();
            }
            return new PaymentCursor(
                    Instant.parse(decoded.substring(0, separator)), UUID.fromString(decoded.substring(separator + 1)));
        } catch (IllegalArgumentException | DateTimeParseException malformed) {
            throw new InvalidPaymentCursorException();
        }
    }
}
