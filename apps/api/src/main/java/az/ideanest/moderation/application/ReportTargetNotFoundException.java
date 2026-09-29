package az.ideanest.moderation.application;

import az.ideanest.moderation.domain.ReportTargetType;
import java.util.UUID;

/**
 * There is nothing at that identifier for this caller to report.
 *
 * <p>404, and the same 404 whether the thing never existed, was deleted, or is a
 * campaign the public cannot see. {@code PublicProjects} draws that line and this
 * inherits it: a draft is confidential and a suspended campaign is one trust and
 * safety has already stopped, so confirming either exists would turn the report
 * endpoint into the oracle every other public endpoint refuses to be.
 *
 * <p>The reference is a string because an account is reported by its public slug
 * (#143) while every other target is reported by its identifier. Only the type
 * reaches the response; the reference is for the log.
 */
public class ReportTargetNotFoundException extends RuntimeException {

    private final transient ReportTargetType targetType;
    private final transient String reference;

    public ReportTargetNotFoundException(ReportTargetType targetType, UUID targetId) {
        this(targetType, targetId.toString());
    }

    public ReportTargetNotFoundException(ReportTargetType targetType, String reference) {
        super("No " + targetType + " " + reference + " to report");
        this.targetType = targetType;
        this.reference = reference;
    }

    public ReportTargetType targetType() {
        return targetType;
    }

    /** The identifier, or for an account the slug, that named nothing. */
    public String reference() {
        return reference;
    }
}
