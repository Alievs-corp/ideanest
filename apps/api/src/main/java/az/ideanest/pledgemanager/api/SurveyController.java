package az.ideanest.pledgemanager.api;

import az.ideanest.pledgemanager.application.SurveyResponseService;
import az.ideanest.pledgemanager.application.SurveyService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.8's PM-01 to PM-05 over HTTP, for the creator.
 *
 * <p><strong>Two path shapes, and the split is §10.2's.</strong> Creating and listing
 * are on the campaign, because that is what a new survey belongs to and what a list is
 * of. Everything else is on the survey itself: the identifier is unique, and a client
 * holding one should not have to remember which campaign it came from. The campaign is
 * loaded from the survey and the capability is checked against that, so the
 * authorisation is exactly as strong as a nested path would make it.
 *
 * <p>Building and sending need {@code PUBLISH_UPDATES} — a survey speaks to backers in
 * the campaign's name. Reading the responses needs {@code VIEW_FINANCES}, because a
 * response names a backer and what they told the campaign. Both checks are in the
 * services.
 *
 * <p>Every read is {@code no-store}: a draft survey is unannounced campaign content,
 * and the responses are personal data.
 */
@RestController
public class SurveyController {

    private final SurveyService surveys;
    private final SurveyResponseService responses;

    public SurveyController(SurveyService surveys, SurveyResponseService responses) {
        this.surveys = surveys;
        this.responses = responses;
    }

    /** The campaign's surveys, newest first, drafts included. */
    @GetMapping("/v1/projects/{projectId}/surveys")
    public ResponseEntity<SurveyListResponse> list(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID projectId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SurveyListResponse.of(surveys.list(projectId, callerOf(accessToken))));
    }

    /**
     * Creates a draft.
     *
     * <p>201, because a survey is a new resource with an identifier the client needs in
     * order to send it afterwards.
     */
    @PostMapping("/v1/projects/{projectId}/surveys")
    public ResponseEntity<SurveyResponseBody> create(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @Valid @RequestBody SurveyRequest request) {

        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(SurveyResponseBody.of(
                        surveys.create(projectId, callerOf(accessToken), request.toDefinition())));
    }

    /** One survey with its questions. */
    @GetMapping("/v1/surveys/{surveyId}")
    public ResponseEntity<SurveyResponseBody> read(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID surveyId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SurveyResponseBody.of(surveys.read(surveyId, callerOf(accessToken))));
    }

    /**
     * Rewrites a survey.
     *
     * <p>{@code PUT}, and the whole thing: a question left out of the body is one the
     * creator deleted. On a sent survey the questions may not change and the refusal
     * says so — see {@code SurveyService}.
     */
    @PutMapping("/v1/surveys/{surveyId}")
    public ResponseEntity<SurveyResponseBody> update(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID surveyId,
            @Valid @RequestBody SurveyRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SurveyResponseBody.of(
                        surveys.update(surveyId, callerOf(accessToken), request.toDefinition())));
    }

    /** Deletes a draft. A sent survey cannot be deleted — its answers are what a creator ships from. */
    @DeleteMapping("/v1/surveys/{surveyId}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID surveyId) {
        surveys.delete(surveyId, callerOf(accessToken));
        return ResponseEntity.noContent().build();
    }

    /**
     * PM-04: sends it to the campaign's backers.
     *
     * <p>200 with the survey rather than 202, and the survey carries {@code sentTo}:
     * what a creator most needs back from this call is how many people it just reached,
     * and finding out by reloading would make the number look like a separate fact from
     * the send.
     *
     * <p>No rate limiter. A survey can only be sent once, which is a stronger bound than
     * any limiter — {@code CampaignMessageController} needs one because a message can be
     * sent repeatedly.
     */
    @PostMapping("/v1/surveys/{surveyId}/send")
    public ResponseEntity<SurveyResponseBody> send(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID surveyId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SurveyResponseBody.of(surveys.send(surveyId, callerOf(accessToken))));
    }

    /** What came back. {@code VIEW_FINANCES}, and {@code no-store} — this names people. */
    @GetMapping("/v1/surveys/{surveyId}/responses")
    public ResponseEntity<SurveyResponseListResponse> collected(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID surveyId,
            @RequestParam(name = "size", required = false) Integer size) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SurveyResponseListResponse.of(
                        responses.collected(surveyId, callerOf(accessToken), size)));
    }

    /** The account making the request, from our own signature and never from the body. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
