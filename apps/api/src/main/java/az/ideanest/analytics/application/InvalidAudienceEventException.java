package az.ideanest.analytics.application;

/**
 * An audience event whose fields do not fit together — #633: a campaign event naming no
 * campaign, a site visit naming one, a click without a surface.
 *
 * <p>A 400, so that a client sending the wrong shape finds out while it is being
 * written. A beacon's caller never reads the answer, which is why the message is for
 * the developer reading the network panel.
 */
public class InvalidAudienceEventException extends IllegalArgumentException {

    public InvalidAudienceEventException(String message) {
        super(message);
    }
}
