package az.ideanest.community.api;

import az.ideanest.community.application.CampaignViewerService.ViewerState;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * {@code GET /v1/projects/{projectId}/viewer}: what the signed-in reader has already said about
 * this campaign, so its page can draw Save, Remind and Follow as the reader left them — #137.
 *
 * <p>Four booleans and never absent, so a client draws "off" from {@code false} rather than from
 * a missing field it has to guess about. The descriptions are in the contract because
 * {@code backed} in particular is a decision — which pledge states count — that a client would
 * otherwise have to reverse-engineer.
 */
@Schema(description = "The signed-in reader's own state on one campaign (#137). Private and never cached.")
public record CampaignViewerResponse(
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        description = "The campaign is on this account's saved list (GET /v1/me/saved).")
                boolean saved,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        description = "This account asked to be told when the campaign opens"
                                + " (POST /v1/projects/{id}/remind while signed in). A reminder"
                                + " registered with a bare email address is not counted, because"
                                + " the signed-in DELETE does not remove it.")
                boolean reminded,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        description = "This account follows the campaign's creator"
                                + " (POST /v1/users/{slug}/follow).")
                boolean followingCreator,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        description = "This account holds a pledge on the campaign in COLLECTED"
                                + " or FULFILLED. A DRAFT (a checkout in progress) is not a backing,"
                                + " and neither is a pledge that EXPIRED, was cancelled, REFUNDED or"
                                + " charged back.")
                boolean backed) {

    public static CampaignViewerResponse of(ViewerState state) {
        return new CampaignViewerResponse(state.saved(), state.reminded(), state.followingCreator(), state.backed());
    }
}
