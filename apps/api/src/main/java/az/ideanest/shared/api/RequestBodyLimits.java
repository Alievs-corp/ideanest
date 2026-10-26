package az.ideanest.shared.api;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

/**
 * The largest request body this service reads — #587.
 *
 * <p>Tomcat bounds a form post and Spring bounds a multipart upload, and nothing bounded
 * anything else: a JSON or CSV body was read into memory whatever its size, so one
 * request could spend a gigabyte of heap on a body a handler was about to refuse.
 * {@link RequestBodyLimitFilter} applies these to every request that is not multipart.
 *
 * <p>Media never arrives here — covers, avatars and story images go straight to object
 * storage on a presigned URL — so the honest sizes are small. Two of them, because one
 * endpoint legitimately takes a file:
 *
 * @param maxBody every JSON (or other) body. Two megabytes is many times the largest a
 *     client sends in practice — a long campaign story is tens of kilobytes — and the
 *     figure Tomcat itself uses for what it will swallow of a refused upload
 * @param maxImportBody {@code POST /v1/projects/{id}/fulfilments/import}, PM-20's tracking
 *     file: the creator's own backer export sent back with two columns filled in, up to
 *     the import's ten-thousand-row cap. Ten megabytes is a thousand bytes a row, several
 *     times what a row of that eleven-column export carries
 */
@ConfigurationProperties(prefix = "ideanest.request-body")
public record RequestBodyLimits(DataSize maxBody, DataSize maxImportBody) {

    private static final DataSize DEFAULT_MAX_BODY = DataSize.ofMegabytes(2);

    private static final DataSize DEFAULT_MAX_IMPORT_BODY = DataSize.ofMegabytes(10);

    public RequestBodyLimits {
        // Omitted means the defaults above, never "unlimited": a ceiling that a missing
        // property switches off is a ceiling nobody notices is gone.
        maxBody = maxBody == null ? DEFAULT_MAX_BODY : maxBody;
        maxImportBody = maxImportBody == null ? DEFAULT_MAX_IMPORT_BODY : maxImportBody;
        if (maxBody.toBytes() < 1 || maxImportBody.toBytes() < 1) {
            throw new IllegalArgumentException("A request body ceiling is at least one byte");
        }
    }

    /** The defaults, for a caller with no configuration to bind. */
    public static RequestBodyLimits defaults() {
        return new RequestBodyLimits(null, null);
    }
}
