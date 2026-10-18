package az.ideanest.legal.application;

import az.ideanest.legal.domain.DocumentKind;
import java.time.Instant;

/**
 * Asked to show readers a version whose effective date has not arrived.
 *
 * <p>409: the version exists and the caller may choose versions, but its state refuses it.
 * Showing it would put on the website a text that does not govern yet — while the console
 * told the administrator it was "now shown" and {@code LegalDocuments.inForce} quietly kept
 * serving the previous one. It shows itself on its date; nothing has to be pressed.
 */
public class VersionNotYetEffectiveException extends RuntimeException {

    private final DocumentKind kind;
    private final int version;
    private final Instant effectiveFrom;

    public VersionNotYetEffectiveException(DocumentKind kind, int version, Instant effectiveFrom) {
        super(kind + " version " + version + " takes effect at " + effectiveFrom);
        this.kind = kind;
        this.version = version;
        this.effectiveFrom = effectiveFrom;
    }

    public DocumentKind kind() {
        return kind;
    }

    public int version() {
        return version;
    }

    public Instant effectiveFrom() {
        return effectiveFrom;
    }
}
