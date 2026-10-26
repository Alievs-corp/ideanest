package az.ideanest.pledgemanager.api;

import az.ideanest.pledgemanager.application.SurveyResponseService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.8's PM-05 and PM-06 over HTTP, for the backer.
 *
 * <p><strong>A separate controller from {@code SurveyController}</strong>, although
 * both are about surveys, because the two have nothing in common but the noun. This one
 * takes no campaign identifier, checks no capability, and returns a projection that
 * omits the recipient and response counts — how many other people answered is the
 * creator's business, and a client should not have to be trusted to hide it.
 *
 * <p>Splitting them also keeps the exception advice honest: a backer's refusals are
 * about their own pledge, and a creator's are about a capability.
 *
 * <p>Both endpoints require a bearer token by falling through to
 * {@code SecurityConfiguration}'s catch-all, and both are {@code no-store}: what a
 * backer told a campaign about themselves is not something a shared cache should hold.
 */
@RestController
public class BackerSurveyController {

    private final SurveyResponseService responses;

    public BackerSurveyController(SurveyResponseService responses) {
        this.responses = responses;
    }

    /**
     * Every survey this account is being asked, across every campaign they backed.
     *
     * <p>Built from their backings rather than from a stored recipient list — no such
     * list exists, and {@code SurveySentEvent} says why. A backer who pledged after a
     * survey went out still finds it, which is what a creator wants and needs no repair
     * job to achieve.
     */
    @GetMapping("/v1/me/surveys")
    public ResponseEntity<BackerSurveyListResponse> mine(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(BackerSurveyListResponse.of(responses.mine(callerOf(accessToken))));
    }

    /**
     * PM-05 and PM-06: answers, or changes the answers to, one survey.
     *
     * <p>200 rather than 201 even on a first submission, and deliberately: PM-06 makes
     * this one row that moves, not a new resource each time. A 201 would suggest the
     * second submission created a second answer, which is the one thing V35 makes
     * impossible.
     */
    @PostMapping("/v1/surveys/{surveyId}/respond")
    public ResponseEntity<BackerSurveyBody> respond(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID surveyId,
            @Valid @RequestBody RespondRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(BackerSurveyBody.of(responses.respond(
                        surveyId, request.pledgeId(), callerOf(accessToken), request.byQuestion())));
    }

    /** The account making the request, from our own signature and never from the body. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
