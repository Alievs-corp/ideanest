package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.application.LaunchReminderJob;
import az.ideanest.project.domain.ActorRole;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.ProjectStateTransition;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.project.infrastructure.ProjectStateTransitionRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.RecordingLaunchReminderNotifier;
import az.ideanest.user.infrastructure.UserRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Pre-launch pages and launch reminders, over HTTP.
 *
 * <p>The tests that carry the design are the three CLAUDE.md §3 calls
 * non-optional. {@link #openingThePrelaunchPageIsAudited()} is the state
 * transition; {@link #registeringTwiceIsOneRow()} and
 * {@link #registeringWhileSignedInSupersedesTheAnonymousRow()} are idempotency on
 * the way in; and {@link #aFailedSendLeavesTheRestPendingAndNobodyIsToldTwice()}
 * is idempotency on the way out — the one that decides whether a crash halfway
 * through a launch costs a follower their notification or costs everybody a
 * duplicate.
 *
 * <p>The pre-launch page is also the first public endpoint in this module, so a
 * fair share of what is asserted here is what it does <em>not</em> say: no goal,
 * no story, and a 404 rather than a 409 for a campaign nobody has announced.
 */
class PrelaunchApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    private static Creator MODERATOR;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private CategoryRepository categories;

    @Autowired
    private ProjectStateTransitionRepository transitions;

    @Autowired
    private RecordingLaunchReminderNotifier notifier;

    @Autowired
    private LaunchReminderJob reminderJob;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void resetNotifier() {
        notifier.clear();
    }

    @AfterEach
    void clearProjects() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // Reminders cascade from projects, but the sweep looks for every live
        // campaign that still owes a notice — so a test that left rows behind
        // would have the next test's launch send them.
        jdbc.update("DELETE FROM reminders");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Creator(String accessToken, UUID id, EmailAddress email) {
    }

    private Creator creator() {
        return account("follower" + SEQUENCE.incrementAndGet() + "@example.com", "Test Creator");
    }

    private Creator account(String address, String name) {
        EmailAddress email = EmailAddress.of(address);
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", name),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        // Publishing needs a plan since V62. Written rather than bought, because this
        // suite is not about them -- Campaigns.mayPublish carries both preconditions.
        Campaigns.mayPublish(dataSource, id);
        return new Creator((String) signedIn.getBody().get("accessToken"), id, email);
    }

    /** Cached for the class, for the reason {@code ProjectLifecycleApiTests} gives. */
    private Creator moderator() {
        if (MODERATOR == null) {
            MODERATOR = account(MODERATOR_EMAIL, "Test Moderator");
        }
        return MODERATOR;
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return rest.exchange(
                path,
                HttpMethod.POST,
                new HttpEntity<>(body, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /** A call with no credentials at all — which is most of this file. */
    private ResponseEntity<Map<String, Object>> anonymously(String path, HttpMethod method, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static UUID idOf(Map<String, Object> project) {
        return UUID.fromString((String) project.get("id"));
    }

    /**
     * A draft with everything a launch needs.
     *
     * <p>Which is everything §5.3 needs, because #37 made submission re-check the
     * completeness checklist and the only route to {@code LIVE} runs through
     * {@code SUBMITTED}. This used to set a goal and a duration and nothing else,
     * and every test in this class that launched a campaign began failing with
     * "a project in PRELAUNCH cannot move to LIVE" — the submission had been
     * refused, the approval had nothing to approve, and the launch was the first
     * step loud enough to notice. {@link Campaigns#completeBasics} is the shared
     * fixture so that the next rule added to §5.3 is added in one place rather
     * than in every suite that needs a launched campaign.
     */
    private UUID fundableDraft(Creator creator, String title) {
        Map<String, Object> project =
                post("/v1/projects", creator.accessToken(), Map.of("title", title)).getBody();

        Map<String, Object> body = new LinkedHashMap<>(Campaigns.completeBasics(categories));

        rest.exchange(
                "/v1/projects/" + idOf(project),
                HttpMethod.PATCH,
                new HttpEntity<>(body, bearer(creator.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        return idOf(project);
    }

    /** A campaign with an open pre-launch page, which is where reminders are collected. */
    private UUID prelaunching(Creator creator, String title) {
        UUID id = fundableDraft(creator, title);
        assertThat(post("/v1/projects/" + id + "/prelaunch", creator.accessToken(), null)
                        .getBody())
                .containsEntry("state", "PRELAUNCH");
        return id;
    }

    /**
     * The real route to {@code LIVE}: submit, then approve, which publishes it (#552).
     *
     * <p><strong>Every step is asserted, not just the last one.</strong> This
     * previously checked only the final state, so when #37 started refusing an
     * incomplete submission the first two calls failed in silence and the failure
     * arrived as "a project in PRELAUNCH cannot move to LIVE" — a message about the
     * step that was fine, naming a state two transitions earlier than the mistake.
     * A fixture that hides which of its steps broke costs more to read than it
     * saves to write.
     */
    private void launch(Creator creator, UUID id) {
        assertThat(post("/v1/projects/" + id + "/submit", creator.accessToken(), null)
                        .getBody())
                .containsEntry("state", "SUBMITTED");
        assertThat(post("/v1/admin/moderation/" + id + "/approve", moderator().accessToken(), null)
                        .getBody())
                .containsEntry("state", "LIVE");
    }

    private ResponseEntity<Map<String, Object>> remindAs(UUID projectId, String address) {
        return anonymously("/v1/projects/" + projectId + "/remind", HttpMethod.POST, Map.of("email", address));
    }

    /**
     * An address no other test in this class has used.
     *
     * <p>Not decoration. The suite shares one process and therefore one rate
     * limiter, and {@code application-test.yml} leaves the per-address limit at a
     * value a test can reach — deliberately, so that
     * {@link #registrationIsRateLimitedPerAddress()} exercises the real control.
     * A literal address reused across tests would make them fail each other rather
     * than fail themselves, which is the most expensive kind of flake to diagnose.
     */
    private static String address(String label) {
        return label + SEQUENCE.incrementAndGet() + "@example.com";
    }

    private long followersOf(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM reminders WHERE project_id = ?", Long.class, projectId);
    }

    // ------------------------------------------------------------------
    // Opening the pre-launch page — the transition
    // ------------------------------------------------------------------

    @Test
    @DisplayName("opening the pre-launch page moves DRAFT to PRELAUNCH and writes one audit row")
    void openingThePrelaunchPageIsAudited() {
        Creator creator = creator();
        UUID id = fundableDraft(creator, "An unannounced product");

        assertThat(post("/v1/projects/" + id + "/prelaunch", creator.accessToken(), null)
                        .getBody())
                .containsEntry("state", "PRELAUNCH");

        // The whole reason ProjectTransitionService exists: the edge, the state,
        // and the row are one transaction. A pre-launch page that opened without a
        // row would be a campaign that went public and nobody can say when or by
        // whom.
        List<ProjectStateTransition> history = transitions.findByProjectIdOrderByCreatedAtAsc(id);
        assertThat(history)
                .extracting(ProjectStateTransition::getToState)
                .containsExactly(ProjectState.DRAFT, ProjectState.PRELAUNCH);
        assertThat(history.getLast().getActorRole()).isEqualTo(ActorRole.CREATOR);
        assertThat(history.getLast().getActorId()).isEqualTo(creator.id());
    }

    @Test
    @DisplayName("only the creator can open a pre-launch page")
    void openingIsTheCreatorsAlone() {
        Creator owner = creator();
        Creator stranger = creator();
        UUID id = fundableDraft(owner, "An unannounced product");

        // 404 rather than 403: a draft is confidential, and telling a stranger that
        // the campaign exists is the leak this answer prevents.
        assertThat(post("/v1/projects/" + id + "/prelaunch", stranger.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        assertThat(get("/v1/projects/" + id + "/edit", owner.accessToken()).getBody())
                .containsEntry("state", "DRAFT");
    }

    @Test
    @DisplayName("a pre-launch page cannot be opened twice, and the refusal says what is possible")
    void openingIsNotRepeatable() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/projects/" + id + "/prelaunch", creator.accessToken(), null);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_TRANSITION_NOT_ALLOWED");
        // §6.1 has no PRELAUNCH -> PRELAUNCH edge, and no way back to DRAFT either.
        assertThat(refused.getBody().get("meta"))
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("state", "PRELAUNCH")
                .containsEntry("requested", "PRELAUNCH");
    }

    @Test
    @DisplayName("opening the pre-launch page needs a bearer token")
    void openingIsBehindAuthentication() {
        Creator creator = creator();
        UUID id = fundableDraft(creator, "An unannounced product");

        // The public GET on this exact path is permitted; the POST is not. If the
        // filter chain ever stops distinguishing the two, anybody could publish
        // somebody else's draft.
        assertThat(anonymously("/v1/projects/" + id + "/prelaunch", HttpMethod.POST, null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // The public page
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the pre-launch page is public, and carries only what a pre-launch page shows")
    void thePageIsPublicAndNarrow() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        Map<String, Object> page =
                anonymously("/v1/projects/" + id + "/prelaunch", HttpMethod.GET, null).getBody();

        assertThat(page).containsEntry("title", "An unannounced product");
        assertThat(page).containsEntry("state", "PRELAUNCH");
        assertThat(page).containsEntry("followerCount", 0);
        assertThat(page.get("slug")).isEqualTo("an-unannounced-product");

        // The line this issue draws against the public project page, which belongs
        // to another epic: no creator, no goal, no story, no category. Each of them
        // is a field of that projection, and deciding its shape here by accident is
        // exactly what this assertion exists to prevent.
        assertThat(page)
                .doesNotContainKeys("goal", "story", "risks", "categoryId", "creatorId", "durationDays", "deadline");
    }

    @Test
    @DisplayName("a campaign nobody has announced is a 404, not a refusal that admits it exists")
    void anUnannouncedCampaignIsNotFound() {
        Creator creator = creator();
        UUID id = fundableDraft(creator, "An unannounced product");

        assertThat(anonymously("/v1/projects/" + id + "/prelaunch", HttpMethod.GET, null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        // And the same answer on the write path. A 409 here would tell whoever holds
        // the identifier that it is a campaign somebody is preparing.
        assertThat(remindAs(id, address("curious")).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("the page is served with a cache header, per §10.3")
    void thePageIsCacheable() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        ResponseEntity<String> page = rest.exchange(
                "/v1/projects/" + id + "/prelaunch",
                HttpMethod.GET,
                new HttpEntity<>(jsonHeaders()),
                String.class);

        assertThat(page.getHeaders().getCacheControl()).contains("max-age=60").contains("public");
    }

    // ------------------------------------------------------------------
    // Registering a reminder
    // ------------------------------------------------------------------

    @Test
    @DisplayName("somebody with no account can ask to be reminded")
    void anAnonymousVisitorCanRegister() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        String stranger = address("stranger");
        ResponseEntity<Map<String, Object>> registered = remindAs(id, stranger);

        assertThat(registered.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(registered.getBody()).containsEntry("following", true);
        assertThat(registered.getBody()).containsEntry("followerCount", 1);
        assertThat(followersOf(id)).isEqualTo(1);

        // The point of the whole feature: no account was created, and none was
        // asked for.
        assertThat(users.findByEmailAndDeletedAtIsNull(EmailAddress.of(stranger))).isEmpty();
    }

    @Test
    @DisplayName("registering twice is one row, and the two answers are indistinguishable")
    void registeringTwiceIsOneRow() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        String stranger = address("stranger");
        Map<String, Object> first = remindAs(id, stranger).getBody();
        Map<String, Object> second = remindAs(id, stranger.toUpperCase(java.util.Locale.ROOT)).getBody();

        // One row, enforced by the unique index rather than by a check in the
        // service: two clicks on a slow connection would both read no row and both
        // insert, and the campaign would owe that person two emails.
        assertThat(followersOf(id)).isEqualTo(1);
        // Case-folded, because citext and EmailAddress agree on what one address is.
        assertThat(second).isEqualTo(first);
    }

    @Test
    @DisplayName("a signed-in visitor's reminder belongs to their account")
    void aSignedInVisitorRegistersAgainstTheirAccount() {
        Creator creator = creator();
        Creator visitor = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        // No body at all: a signed-in caller does not say where to write, because
        // the account's verified address is the one we would use anyway.
        assertThat(post("/v1/projects/" + id + "/remind", visitor.accessToken(), null)
                        .getBody())
                .containsEntry("followerCount", 1);
        assertThat(post("/v1/projects/" + id + "/remind", visitor.accessToken(), null)
                        .getBody())
                .containsEntry("followerCount", 1);

        assertThat(followersOf(id)).isEqualTo(1);
        Map<String, Object> row = new JdbcTemplate(dataSource)
                .queryForMap("SELECT user_id, email FROM reminders WHERE project_id = ?", id);
        // §17.4: the address is a reference, not a copy. An anonymised account must
        // not leave its address behind in this table.
        assertThat(row.get("user_id")).isEqualTo(visitor.id());
        assertThat(row.get("email")).isNull();
    }

    @Test
    @DisplayName("registering while signed in supersedes the same person's anonymous row")
    void registeringWhileSignedInSupersedesTheAnonymousRow() {
        Creator creator = creator();
        Creator visitor = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        // Signed out first — the ordinary case, because a pre-launch link is
        // usually opened from somebody else's post.
        remindAs(id, visitor.email().value());
        assertThat(followersOf(id)).isEqualTo(1);

        // Then signed in. The two identities are provably one person: the address
        // came from our own users row, which registration verified. Without this
        // they would be two rows and two launch emails.
        post("/v1/projects/" + id + "/remind", visitor.accessToken(), null);

        assertThat(followersOf(id)).isEqualTo(1);
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject("SELECT user_id FROM reminders WHERE project_id = ?", UUID.class, id))
                .isEqualTo(visitor.id());
    }

    @Test
    @DisplayName("a reminder on a campaign that has already launched is a 409 naming the state")
    void aReminderOnALiveCampaignIsRefused() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");
        launch(creator, id);

        ResponseEntity<Map<String, Object>> refused = remindAs(id, address("late"));

        // The visitor left the page open while the campaign opened. 409 rather than
        // 400, and the state is in the body so the client can offer the campaign
        // rather than the reminder.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "REMINDERS_CLOSED");
        assertThat(refused.getBody().get("meta"))
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("state", "LIVE")
                .containsEntry("acceptedIn", List.of("PRELAUNCH", "SCHEDULED"));
    }

    @Test
    @DisplayName("a reminder needs somewhere to write to")
    void aReminderWithoutAnAddressIsRefused() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        ResponseEntity<Map<String, Object>> refused =
                anonymously("/v1/projects/" + id + "/remind", HttpMethod.POST, Map.of());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "email"));

        // And something that is not an address at all.
        assertThat(remindAs(id, "not-an-address").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("one address cannot be subscribed to every campaign on the platform")
    void registrationIsRateLimitedPerAddress() {
        Creator creator = creator();
        String victim = address("victim");

        // application-test.yml allows three per address per window. The limit that
        // matters is this one rather than the per-client one: subscribing somebody
        // else's address to everything is mail-bombing them with our domain on it.
        for (int campaign = 0; campaign < 3; campaign++) {
            UUID id = prelaunching(creator, "Campaign " + campaign);
            assertThat(remindAs(id, victim).getStatusCode()).isEqualTo(HttpStatus.OK);
        }

        UUID fourth = prelaunching(creator, "Campaign 4");
        ResponseEntity<Map<String, Object>> refused = remindAs(fourth, victim);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(refused.getHeaders().getFirst("Retry-After")).isNotNull();
    }

    // ------------------------------------------------------------------
    // Withdrawing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a signed-in follower can take themselves off the list, twice if they like")
    void aSignedInFollowerCanWithdraw() {
        Creator creator = creator();
        Creator visitor = creator();
        UUID id = prelaunching(creator, "An unannounced product");
        post("/v1/projects/" + id + "/remind", visitor.accessToken(), null);

        ResponseEntity<Map<String, Object>> gone = rest.exchange(
                "/v1/projects/" + id + "/remind",
                HttpMethod.DELETE,
                new HttpEntity<>(bearer(visitor.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(gone.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(followersOf(id)).isZero();

        // Idempotent, and deliberately silent about whether it removed anything: a
        // response that said would answer "does this person follow this campaign".
        assertThat(rest.exchange(
                                "/v1/projects/" + id + "/remind",
                                HttpMethod.DELETE,
                                new HttpEntity<>(bearer(visitor.accessToken())),
                                Void.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
    }

    @Test
    @DisplayName("an unsubscribe with no credential at all is refused")
    void withdrawingNeedsSomethingToIdentifyTheRow() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");
        remindAs(id, address("stranger"));

        assertThat(anonymously("/v1/projects/" + id + "/remind", HttpMethod.DELETE, null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(followersOf(id)).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // Telling everybody the campaign opened
    // ------------------------------------------------------------------

    @Test
    @DisplayName("launching tells every follower once, and the row records that it did")
    void launchingNotifiesEveryFollower() {
        Creator creator = creator();
        Creator signedIn = creator();
        UUID id = prelaunching(creator, "An unannounced product");

        String one = address("one");
        String two = address("two");
        remindAs(id, one);
        remindAs(id, two);
        post("/v1/projects/" + id + "/remind", signedIn.accessToken(), null);

        launch(creator, id);

        // The event fires after the launch commits, so by the time the response is
        // written the messages have been handed to the port.
        assertThat(notifier.sentFor(id))
                .extracting(sent -> sent.email().value())
                .containsExactlyInAnyOrder(one, two, signedIn.email().value());

        // The account's address was resolved at send time from `users`, not copied
        // into `reminders` when it registered.
        assertThat(notifier.sentFor(id))
                .filteredOn(sent -> sent.accountId() != null)
                .singleElement()
                .satisfies(sent -> assertThat(sent.accountId()).isEqualTo(signedIn.id()));

        // Delivery state is on the row, which is what makes the sweep resumable —
        // and every notified row carries the unsubscribe link that was sent with it.
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT count(*) FROM reminders WHERE project_id = ?"
                                        + " AND notified_at IS NOT NULL AND unsubscribe_token_hash IS NOT NULL",
                                Long.class,
                                id))
                .isEqualTo(3);
    }

    @Test
    @DisplayName("sweeping again after a launch tells nobody a second time")
    void theSweepIsIdempotent() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");
        EmailAddress one = EmailAddress.of(address("one"));
        remindAs(id, one.value());

        launch(creator, id);
        assertThat(notifier.timesSentTo(one)).isEqualTo(1);

        // §8.4's reminder-sender runs every minute, so this is not a hypothetical:
        // the sweep passes over every live campaign repeatedly for as long as it has
        // reminders, and a second message is what a follower reports as spam.
        assertThat(reminderJob.sendDueReminders()).isZero();
        assertThat(reminderJob.sendDueReminders()).isZero();
        assertThat(notifier.timesSentTo(one)).isEqualTo(1);
    }

    @Test
    @DisplayName("a failed send leaves the rest pending, and nobody is told twice")
    void aFailedSendLeavesTheRestPendingAndNobodyIsToldTwice() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");
        // Four followers against a batch size of three, so the sweep's second pass
        // is exercised rather than described.
        remindAs(id, address("one"));
        remindAs(id, address("two"));
        remindAs(id, address("three"));
        remindAs(id, address("four"));

        // The transport is down when the campaign opens. The launch itself must
        // still succeed — a campaign that cannot go live because a mail server is
        // unreachable is the wrong failure.
        notifier.failNext(true);
        launch(creator, id);
        assertThat(notifier.sentFor(id)).isEmpty();

        // Nothing was claimed, so nothing was silently dropped: the send is inside
        // the transaction that stamps the row, and a throw rolls the stamp back.
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT count(*) FROM reminders WHERE project_id = ? AND notified_at IS NOT NULL",
                                Long.class,
                                id))
                .isZero();

        notifier.failNext(false);
        assertThat(reminderJob.sendDueReminders()).isEqualTo(4);
        assertThat(notifier.sentFor(id)).hasSize(4);

        // And the pass after that finds nothing left to do.
        assertThat(reminderJob.sendDueReminders()).isZero();
        assertThat(notifier.sentFor(id)).hasSize(4);
    }

    @Test
    @DisplayName("the launch notice carries a link that removes the reminder")
    void theLaunchNoticeCarriesAWorkingUnsubscribe() {
        Creator creator = creator();
        UUID id = prelaunching(creator, "An unannounced product");
        remindAs(id, address("one"));
        launch(creator, id);

        String token = notifier.sentFor(id).getFirst().unsubscribeToken();
        assertThat(token).isNotBlank();

        // The token exists in the message and as a SHA-256 on the row. A test that
        // read the hash would prove only that a token exists; this proves the one
        // that was sent is the one that works.
        ResponseEntity<Void> gone = rest.exchange(
                "/v1/projects/" + id + "/remind?token=" + token,
                HttpMethod.DELETE,
                new HttpEntity<>(jsonHeaders()),
                Void.class);

        assertThat(gone.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(followersOf(id)).isZero();
    }

    @Test
    @DisplayName("a campaign that launched with no followers is not swept for ever")
    void aCampaignWithNoFollowersIsNotWorkedOn() {
        Creator creator = creator();
        UUID id = fundableDraft(creator, "An unannounced product");
        launch(creator, id);

        // The sweep asks which live campaigns still owe a notice, not which are
        // live. A campaign that never opened a pre-launch page owes nothing.
        assertThat(reminderJob.sendDueReminders()).isZero();
        assertThat(notifier.sentFor(id)).isEmpty();
    }
}
