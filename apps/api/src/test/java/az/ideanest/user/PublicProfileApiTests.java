package az.ideanest.user;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.application.PublicProfiles;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * The public profile and the switch that withdraws it — §4.2's P-01 and P-07, over HTTP.
 *
 * <p><strong>The substance of this endpoint is what it refuses</strong>, and four of these
 * pin it. A slug nobody holds, an account §17.4 has anonymised, and an account whose owner
 * chose {@code PRIVATE} must be indistinguishable from one another — same status, same
 * body, same code — because any difference between them is an oracle a stranger can ask by
 * guessing a name. {@link #aPrivateProfileAnswersExactlyAsAnAbsentOneDoes()} asserts the
 * bodies against each other rather than against a literal, which is the only form of that
 * assertion that cannot pass while the two drift.
 *
 * <p>{@link #theProfileCarriesNothingThatBelongsToItsOwner()} is the other half: this is a
 * second projection of {@code users}, and the reason it exists rather than reusing
 * {@code MeResponse} is that the row holds an address, a verification flag and a deletion
 * date. The test names the keys exhaustively, so a field added to the projection fails here
 * rather than appearing on a public page.
 *
 * <p>Every read is made without a bearer token, because that is what a visitor has. A suite
 * that authenticated would be testing a different endpoint from the one the security
 * matcher opens.
 */
class PublicProfileApiTests extends AbstractIntegrationTest {

    /** Distinguishes the accounts these tests create; a counter, as elsewhere in this suite. */
    /**
     * What this class's fixture accounts are called.
     *
     * <p><strong>Namespaced so they cannot be another suite's.</strong>
     * {@code Campaigns.creator} inserts a {@code users} row and no credential, nothing
     * deletes users between classes, and `role + "-" + counter` is a convention several
     * suites share with counters that all start at one. A suite that takes
     * {@code creator-1@example.com} first leaves the next one unable to register a
     * password against it — its sign-in answers 401, its next call carries
     * {@code Authorization: Bearer null}, and the failure surfaces in a fixture far from
     * the cause and only when the whole suite runs.
     */
    private static final String HANDLE_PREFIX = "profile-";

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private PublicProfiles publicProfiles;

    private JdbcTemplate jdbc;

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    // -----------------------------------------------------------------------
    // What the page says
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the profile carries what §4.2 puts on the page and nothing that belongs to its owner")
    void theProfileCarriesNothingThatBelongsToItsOwner() {
        String slug = account("ayan");
        describe(slug, "https://cdn.example.com/ayan.jpg", "Makes furniture out of reclaimed oak.");

        ResponseEntity<String> response = profile(slug);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

        Map<String, Object> body = parse(response);
        // Exhaustive, on purpose. A field added to the projection fails here rather than
        // appearing on a page served to anybody who types a URL -- and the two fields most
        // likely to be added by accident are the address and the account identifier.
        assertThat(body)
                .containsOnlyKeys(
                        "slug", "name", "avatarUrl", "bio", "joinedAt", "websiteUrl", "location", "socialLinks");
        assertThat(body.get("slug")).isEqualTo(slug);
        assertThat(body.get("bio")).isEqualTo("Makes furniture out of reclaimed oak.");
        assertThat(body.get("joinedAt")).isNotNull();
        assertThat(response.getBody()).doesNotContain("@example.com");
    }

    @Test
    @DisplayName("a profile with no avatar and no bio still answers both keys, as null")
    void anEmptyProfileStillAnswersEveryKey() {
        String slug = account("plain");

        Map<String, Object> body = parse(profile(slug));

        // Written out rather than omitted: a client cannot tell "this person wrote no bio"
        // from "the key I expected is missing", and the second reads as a failed parse.
        assertThat(body).containsKey("avatarUrl").containsKey("bio");
        assertThat(body.get("avatarUrl")).isNull();
        assertThat(body.get("bio")).isNull();
    }

    // -----------------------------------------------------------------------
    // P-07, and §17.4
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a private profile answers exactly as an absent one does")
    void aPrivateProfileAnswersExactlyAsAnAbsentOneDoes() {
        String slug = account("withdrawn");
        jdbc().update("UPDATE users SET profile_visibility = 'PRIVATE' WHERE slug = ?", slug);

        ResponseEntity<String> hidden = profile(slug);
        ResponseEntity<String> absent = profile("nobody-is-called-this-" + SEQUENCE.incrementAndGet());

        // The assertion is the two against each other rather than each against a literal.
        // Written the other way it would keep passing while they drifted, and the drift is
        // the whole failure: any difference confirms, to anybody who can guess a name, that
        // a particular person has an account here and has chosen to hide it.
        assertThat(hidden.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(hidden.getStatusCode()).isEqualTo(absent.getStatusCode());
        assertThat(withoutInstance(hidden)).isEqualTo(withoutInstance(absent));
        assertThat(parse(hidden).get("code")).isEqualTo("USER_NOT_FOUND");
    }

    @Test
    @DisplayName("an anonymised account has no profile, and is not reported as one that used to")
    void anAnonymisedAccountHasNoProfile() {
        String slug = account("leaving");
        assertThat(profile(slug).getStatusCode()).isEqualTo(HttpStatus.OK);

        // What §17.4's anonymisation leaves behind. Written directly rather than driven
        // through the deletion endpoint and the job, because the grace period is thirty days
        // and this suite is about what the profile serves afterwards. Every check constraint
        // still applies -- users_deletion_request_is_complete,
        // users_deletion_is_scheduled_after_request,
        // users_anonymisation_follows_a_request and users_anonymisation_implies_deletion --
        // which is what makes this a row the application could have produced.
        jdbc().update(
                        """
                        UPDATE users
                           SET deletion_requested_at = now() - interval '31 days',
                               deletion_scheduled_at = now() - interval '1 day',
                               anonymised_at = now(),
                               deleted_at = now(),
                               profile_visibility = 'PRIVATE'
                         WHERE slug = ?
                        """,
                        slug);

        ResponseEntity<String> gone = profile(slug);
        assertThat(gone.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        // "Never here", not "gone". §17.4 exists to make it untrue that this platform holds
        // a record of a particular person, and an endpoint that said "gone" would restore
        // that record to anybody who could guess the slug.
        assertThat(parse(gone).get("code")).isEqualTo("USER_NOT_FOUND");
    }

    @Test
    @DisplayName("the owner turns their profile off and on again, and the page follows immediately")
    void theOwnerTurnsTheirProfileOffAndOnAgain() {
        Account owner = registered("switch");

        assertThat(profile(owner.slug()).getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(setVisibility(owner, "PRIVATE").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        // Immediately, and that is what the endpoint's `no-cache` policy is for: a privacy
        // switch whose effect waits out a max-age is a privacy switch that does not work.
        assertThat(profile(owner.slug()).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        assertThat(setVisibility(owner, "PUBLIC").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(profile(owner.slug()).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("setting the visibility twice is not an error")
    void settingTheSameVisibilityTwiceSucceeds() {
        Account owner = registered("idempotent");

        assertThat(setVisibility(owner, "PRIVATE").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        // A retry after a dropped connection, or a second tab submitting the same switch.
        // A refusal here would make the safe direction -- turning the page off -- the one
        // that can fail on a retry.
        assertThat(setVisibility(owner, "PRIVATE").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(jdbc().queryForObject(
                        "SELECT profile_visibility FROM users WHERE id = ?", String.class, owner.id()))
                .isEqualTo("PRIVATE");
    }

    @Test
    @DisplayName("the visibility switch needs a token, and a value it recognises")
    void theVisibilitySwitchIsGuarded() {
        Account owner = registered("guarded");

        ResponseEntity<String> anonymous = rest.exchange(
                "/v1/me/profile-visibility",
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("visibility", "PRIVATE"), jsonHeaders()),
                String.class);
        // Nobody's profile is switched by an unauthenticated request. The endpoint is not
        // named in the security configuration at all and falls through to the catch-all,
        // which is what this asserts is still true.
        assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        // A third value would be a rule the platform would then have to enforce on four
        // surfaces; ProfileVisibility has two and the enum is bound directly, so this is
        // refused before the handler runs.
        assertThat(setVisibility(owner, "FRIENDS_ONLY").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // -----------------------------------------------------------------------
    // §10.3
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the profile revalidates to 304 and is never held past a withdrawal")
    void theProfileRevalidates() {
        String slug = account("cached");

        ResponseEntity<String> first = profile(slug);
        String etag = first.getHeaders().getETag();
        assertThat(etag).isNotNull();
        // no-cache rather than a max-age: "keep this and ask before you use it again". The
        // page can be withdrawn, and a cache holding it for a minute afterwards is a minute
        // of P-07 not working.
        assertThat(first.getHeaders().getCacheControl()).contains("public").contains("no-cache");
        assertThat(first.getHeaders().getCacheControl()).doesNotContain("max-age");

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(etag);
        ResponseEntity<String> revalidated =
                rest.exchange("/v1/users/" + slug, HttpMethod.GET, new HttpEntity<>(conditional), String.class);
        assertThat(revalidated.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        // The policy survives the revalidation. A 304 that dropped it would leave a cache
        // deciding for itself how long the stored body stays fresh.
        assertThat(revalidated.getHeaders().getCacheControl()).contains("no-cache");

        // And the tag moves when the page does, which is the half a digest over a subset of
        // the fields would get wrong.
        describe(slug, null, "Now with a biography.");
        ResponseEntity<String> changed =
                rest.exchange("/v1/users/" + slug, HttpMethod.GET, new HttpEntity<>(conditional), String.class);
        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(changed.getHeaders().getETag()).isNotEqualTo(etag);
    }

    // -----------------------------------------------------------------------
    // A closing account (#647)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("requesting deletion withdraws the profile at once, and cancelling brings it back")
    void requestingDeletionWithdrawsTheProfileAtOnce() {
        Account owner = registered("closing");
        assertThat(profile(owner.slug()).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(archive(owner.slug(), "projects").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(archive(owner.slug(), "backed").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(publicProfiles.publicNames(List.of(owner.id()))).containsKey(owner.id());

        assertThat(requestDeletion(owner).getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        // Not thirty days later at anonymisation: from the request, the page, both archives and
        // the name beside the account's comments answer exactly as a private profile's do.
        ResponseEntity<String> hidden = profile(owner.slug());
        ResponseEntity<String> absent = profile("nobody-is-called-this-" + SEQUENCE.incrementAndGet());
        assertThat(hidden.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(withoutInstance(hidden)).isEqualTo(withoutInstance(absent));
        assertThat(archive(owner.slug(), "projects").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(archive(owner.slug(), "backed").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(publicProfiles.publicNames(List.of(owner.id()))).doesNotContainKey(owner.id());
        // The owner's own setting is not what changed, which is why there is nothing to restore.
        assertThat(visibilityColumn(owner)).isEqualTo("PUBLIC");

        assertThat(cancelDeletion(owner).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(profile(owner.slug()).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(archive(owner.slug(), "projects").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(archive(owner.slug(), "backed").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(publicProfiles.publicNames(List.of(owner.id()))).containsKey(owner.id());
    }

    @Test
    @DisplayName("cancelling a deletion leaves a private profile private")
    void cancellingADeletionLeavesAPrivateProfilePrivate() {
        Account owner = registered("private-closing");
        assertThat(setVisibility(owner, "PRIVATE").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(requestDeletion(owner).getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(profile(owner.slug()).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(cancelDeletion(owner).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        // What the owner had before is what they have after: a cancellation is not a reason to
        // publish a page somebody chose to withdraw.
        assertThat(visibilityColumn(owner)).isEqualTo("PRIVATE");
        assertThat(profile(owner.slug()).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(publicProfiles.publicNames(List.of(owner.id()))).doesNotContainKey(owner.id());
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /** An account with no password, for the reads. Its slug is its handle. */
    private String account(String role) {
        String handle = HANDLE_PREFIX + role + "-" + SEQUENCE.incrementAndGet();
        Campaigns.creator(dataSource, handle, "Test " + role);
        return handle;
    }

    /** Gives the profile the two optional fields §4.2 puts on its about tab. */
    private void describe(String slug, String avatarUrl, String bio) {
        jdbc().update("UPDATE users SET avatar_url = ?, bio = ? WHERE slug = ?", avatarUrl, bio, slug);
    }

    /** A registered, signed-in account: its token, its identifier and its slug. */
    private record Account(String accessToken, UUID id, String slug) {
    }

    private Account registered(String role) {
        String marker = HANDLE_PREFIX + role + "-" + SEQUENCE.incrementAndGet();
        String email = marker + "@example.com";

        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email, "password", PASSWORD, "name", "Test " + role),
                String.class);

        Map<String, Object> signedIn = parse(rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                String.class));

        Map<String, Object> account = jdbc()
                .queryForMap("SELECT id, slug FROM users WHERE email = ?::citext", email);
        return new Account(
                (String) signedIn.get("accessToken"), (UUID) account.get("id"), (String) account.get("slug"));
    }

    // -----------------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------------

    /** Deliberately without a bearer token. This endpoint has no caller to establish. */
    private ResponseEntity<String> profile(String slug) {
        return rest.getForEntity("/v1/users/" + slug, String.class);
    }

    /** One of the profile's two archives: {@code projects} or {@code backed}. */
    private ResponseEntity<String> archive(String slug, String which) {
        return rest.getForEntity("/v1/users/" + slug + "/" + which, String.class);
    }

    private String visibilityColumn(Account owner) {
        return jdbc().queryForObject("SELECT profile_visibility FROM users WHERE id = ?", String.class, owner.id());
    }

    private ResponseEntity<String> requestDeletion(Account owner) {
        return rest.exchange(
                "/v1/me/deletion",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("password", PASSWORD), bearer(owner.accessToken())),
                String.class);
    }

    /**
     * Withdraws the request with a fresh sign-in: the request ended every session, the one
     * that made it included, and signing in again is the way back.
     */
    private ResponseEntity<String> cancelDeletion(Account owner) {
        String email = jdbc().queryForObject("SELECT email FROM users WHERE id = ?", String.class, owner.id());
        Map<String, Object> signedIn = parse(rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                String.class));
        return rest.exchange(
                "/v1/me/deletion",
                HttpMethod.DELETE,
                new HttpEntity<>(bearer((String) signedIn.get("accessToken"))),
                String.class);
    }

    private ResponseEntity<String> setVisibility(Account owner, String visibility) {
        return rest.exchange(
                "/v1/me/profile-visibility",
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("visibility", visibility), bearer(owner.accessToken())),
                String.class);
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

    /**
     * A problem detail with RFC 9457's {@code instance} removed.
     *
     * <p><strong>Excluded on purpose, and it must stay excluded.</strong> {@code instance}
     * is the path that was asked for, so a private profile and an absent one differ in it
     * necessarily — they are different URLs. A stricter assertion would be demanding that
     * the response not say which request it is answering, which is neither true nor
     * desirable, and it would fail for a reason that has nothing to do with the property
     * under test. What must not differ is everything else: {@code status}, {@code type},
     * {@code title}, {@code detail} and {@code code}, because any of those differing is the
     * oracle these tests exist to prevent.
     */
    private Map<String, Object> withoutInstance(ResponseEntity<String> response) {
        Map<String, Object> body = new LinkedHashMap<>(parse(response));
        body.remove("instance");
        return body;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(ResponseEntity<String> response) {
        try {
            return json.readValue(response.getBody(), Map.class);
        } catch (Exception e) {
            throw new IllegalStateException("Not a JSON object: " + response.getBody(), e);
        }
    }
}
