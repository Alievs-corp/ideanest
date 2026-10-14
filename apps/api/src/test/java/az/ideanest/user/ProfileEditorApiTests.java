package az.ideanest.user;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.application.AccountAnonymiser;
import az.ideanest.user.application.AccountDeletionService;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
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
 * The profile editor — §4.2's P-01 to P-03 (#276), over HTTP.
 *
 * <p><strong>What this suite is really about is that the write exists at all.</strong>
 * {@code users.name}, {@code bio} and {@code avatar_url} were columns for forty-five
 * migrations with no endpoint that wrote one, which is the absence §4.2's block quote names
 * as the reason the account navigation has no profile entry. Half of what is asserted here is
 * therefore ordinary — a field goes in, the same field comes out — and the other half is the
 * part a write path gets wrong.
 *
 * <p>That other half is three properties, and each has its own test rather than a line inside
 * a longer one:
 *
 * <ul>
 *   <li><strong>PATCH means merge, not replace.</strong>
 *       {@link #anAbsentKeyIsUntouchedAndAnExplicitNullClears()} is the whole of RFC 7396 in
 *       one method, and it asserts both directions in one request — a body that mentions one
 *       field and nulls another has to leave a third alone. Read the other way round, a
 *       regression here deletes somebody's biography when they change their name.</li>
 *   <li><strong>A refusal is a refusal, not a silent normalisation.</strong> A non-https URL
 *       and an unknown location slug both answer 400 naming the field, because an endpoint
 *       that dropped either would report success for a save that did not happen — and the
 *       person would find out by looking at their own page days later.</li>
 *   <li><strong>Erasure takes everything.</strong>
 *       {@link #anonymisationTakesTheWholeProfileIncludingTheLinks()} is §17.4 and it is the
 *       test this feature could most plausibly have shipped without: a GDPR erasure that
 *       leaves somebody's Instagram address behind has not erased them, and the links are rows
 *       in a table the {@code users} entity does not map, so nothing about clearing the
 *       columns makes them go.</li>
 * </ul>
 *
 * <p>Bodies are written as JSON strings rather than as maps, and that is not a style
 * preference: {@code Map.of} cannot hold a null, and the difference between a key that is
 * absent and a key that is present and null is exactly what half of these tests are about.
 */
class ProfileEditorApiTests extends AbstractIntegrationTest {

    /**
     * What this class's fixture accounts are called.
     *
     * <p><strong>Namespaced so they cannot be another suite's</strong>, for the reason
     * {@code PublicProfileApiTests} states in full: nothing deletes {@code users} between
     * classes, several suites share a {@code role + "-" + counter} convention with counters
     * that all start at one, and the suite that takes a handle first leaves the next one
     * unable to register a password against it — whereupon its sign-in answers 401, its next
     * call carries {@code Authorization: Bearer null}, and the failure surfaces three frames
     * from the cause.
     */
    private static final String HANDLE_PREFIX = "profile-editor-";

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    /** One of V16's eighteen, and the one every Azerbaijani fixture reaches for. */
    private static final String KNOWN_LOCATION = "baki";

    private static final Duration AFTER_THE_GRACE_PERIOD = Duration.ofDays(31);

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccountDeletionService deletions;

    @Autowired
    private AccountAnonymiser anonymiser;

    private JdbcTemplate jdbc;

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    // -----------------------------------------------------------------------
    // The read
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the editor loads the owner's fields, and nothing that belongs to the account rather than the page")
    void theEditorLoadsTheOwnersFields() {
        Account owner = registered("reader");

        ResponseEntity<String> response = readProfile(owner);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

        Map<String, Object> body = parse(response);
        // Exhaustive, on purpose. This is a third projection of `users` and the rule that
        // keeps it apart from the other two is that a field is here only if the owner changes
        // it on a profile screen -- PATCH's six and P-07's visibility -- plus the slug. A field
        // added to the projection fails here rather than appearing in an editor that cannot
        // save it -- and the address, which GET /v1/me owns and A-12 changes, is the one most
        // likely to be added by accident.
        assertThat(body)
                .containsOnlyKeys(
                        "name",
                        "slug",
                        "bio",
                        "avatarUrl",
                        "websiteUrl",
                        "location",
                        "socialLinks",
                        "profileVisibility");
        assertThat(body.get("slug")).isEqualTo(owner.slug());
        assertThat(body.get("profileVisibility")).isEqualTo("PUBLIC");
        assertThat(response.getBody()).doesNotContain("@example.com");

        // Written out rather than omitted, like the public profile beside it: a form that
        // cannot tell an empty field from a missing key renders a spinner where an input
        // belongs. The links are an empty array rather than a null, because an array is a
        // thing a client maps over.
        assertThat(body.get("bio")).isNull();
        assertThat(body.get("websiteUrl")).isNull();
        assertThat(body.get("location")).isNull();
        assertThat(body.get("socialLinks")).isEqualTo(List.of());

        // One person's own data behind a bearer token. There is no shared cache to serve, and
        // nothing here should be written to disk by an intermediary.
        assertThat(response.getHeaders().getCacheControl()).contains("no-store");
    }

    @Test
    @DisplayName("the owner's read carries P-07's position, both ways, and PATCH cannot change it")
    void theOwnersReadCarriesTheVisibility() {
        Account owner = registered("visibility");

        // #270. The privacy screen used to read this from its effect -- an anonymous
        // GET /v1/users/{slug}, 200 for public and 404 for private -- and now reads it here.
        assertThat(parse(readProfile(owner)).get("profileVisibility")).isEqualTo("PUBLIC");

        assertThat(setVisibility(owner, "PRIVATE").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(parse(readProfile(owner)).get("profileVisibility")).isEqualTo("PRIVATE");

        // Read here and written only on its own path. A patch that names it is not refused --
        // an unknown key never is -- and the stored value does not move.
        ResponseEntity<String> patched = patch(owner, "{\"profileVisibility\":\"PUBLIC\"}");
        assertThat(patched.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(parse(patched).get("profileVisibility")).isEqualTo("PRIVATE");

        assertThat(setVisibility(owner, "PUBLIC").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(parse(readProfile(owner)).get("profileVisibility")).isEqualTo("PUBLIC");
    }

    @Test
    @DisplayName("the editor needs a token")
    void theEditorNeedsAToken() {
        assertThat(rest.getForEntity("/v1/me/profile", String.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(patchAnonymously("{\"name\":\"Nobody\"}").getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // -----------------------------------------------------------------------
    // The write
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a patch writes every field the editor owns, and answers the profile as it now stands")
    void aPatchWritesEveryField() {
        Account owner = registered("writer");

        ResponseEntity<String> response = patch(
                owner,
                """
                {
                  "name": "Ayan Məmmədova",
                  "bio": "Makes furniture out of reclaimed oak.",
                  "avatarUrl": "https://cdn.example.com/ayan.jpg",
                  "websiteUrl": "https://ayan.example.com",
                  "locationSlug": "baki",
                  "socialLinks": [
                    {"platform": "INSTAGRAM", "url": "https://instagram.com/ayan"},
                    {"platform": "GITHUB", "url": "https://github.com/ayan"}
                  ]
                }
                """);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> body = parse(response);
        assertThat(body.get("name")).isEqualTo("Ayan Məmmədova");
        assertThat(body.get("bio")).isEqualTo("Makes furniture out of reclaimed oak.");
        assertThat(body.get("avatarUrl")).isEqualTo("https://cdn.example.com/ayan.jpg");
        assertThat(body.get("websiteUrl")).isEqualTo("https://ayan.example.com");

        // The location comes back as the pair a client uses: the endonym to render, and the
        // slug to link to /discover?city= with. This is why the write answers a body rather
        // than 204 -- the client sent one value and gets two back, and could not have derived
        // the second.
        assertThat(body.get("location")).isEqualTo(Map.of("slug", KNOWN_LOCATION, "name", "Bakı"));

        // In the order they were sent. Order is the array's order in both directions, which is
        // why no position crosses the wire.
        assertThat(body.get("socialLinks"))
                .isEqualTo(List.of(
                        Map.of("platform", "INSTAGRAM", "url", "https://instagram.com/ayan"),
                        Map.of("platform", "GITHUB", "url", "https://github.com/ayan")));

        // And it is in the database rather than only in the response.
        Map<String, Object> row = jdbc()
                .queryForMap("SELECT name, bio, avatar_url, website_url, location_id FROM users WHERE id = ?",
                        owner.id());
        assertThat(row.get("website_url")).isEqualTo("https://ayan.example.com");
        assertThat(row.get("location_id")).isNotNull();
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM user_social_links WHERE user_id = ?", Integer.class, owner.id()))
                .isEqualTo(2);
    }

    @Test
    @DisplayName("an absent key is untouched and an explicit null clears — RFC 7396, in one request")
    void anAbsentKeyIsUntouchedAndAnExplicitNullClears() {
        Account owner = registered("merge");
        patch(
                owner,
                """
                {
                  "bio": "Written first.",
                  "websiteUrl": "https://first.example.com",
                  "locationSlug": "baki"
                }
                """);

        // One field named, one field nulled, one field not mentioned at all. The third is the
        // assertion that matters: read the other way round, a regression here deletes
        // somebody's biography every time they change their name.
        Map<String, Object> body = parse(patch(
                owner,
                """
                {
                  "name": "Renamed",
                  "websiteUrl": null
                }
                """));

        assertThat(body.get("name")).isEqualTo("Renamed");
        assertThat(body.get("websiteUrl")).isNull();
        assertThat(body.get("bio")).isEqualTo("Written first.");
        assertThat(body.get("location")).isEqualTo(Map.of("slug", KNOWN_LOCATION, "name", "Bakı"));

        // And an empty body is a successful no-op rather than an error. It is what a form with
        // nothing changed sends.
        assertThat(parse(patch(owner, "{}")).get("bio")).isEqualTo("Written first.");
    }

    @Test
    @DisplayName("an explicit null clears the location and the links, and an empty array clears the links too")
    void nullClearsTheLocationAndTheLinks() {
        Account owner = registered("clearing");
        patch(
                owner,
                """
                {
                  "locationSlug": "gence",
                  "socialLinks": [{"platform": "TIKTOK", "url": "https://tiktok.com/@somebody"}]
                }
                """);

        Map<String, Object> cleared = parse(patch(owner, "{\"locationSlug\": null, \"socialLinks\": null}"));
        assertThat(cleared.get("location")).isNull();
        assertThat(cleared.get("socialLinks")).isEqualTo(List.of());
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM user_social_links WHERE user_id = ?", Integer.class, owner.id()))
                .isZero();

        // An empty array is the other spelling of the same intention, and refusing it would be
        // refusing a form somebody emptied.
        patch(owner, "{\"socialLinks\": [{\"platform\": \"X\", \"url\": \"https://x.com/somebody\"}]}");
        assertThat(parse(patch(owner, "{\"socialLinks\": []}")).get("socialLinks")).isEqualTo(List.of());
    }

    @Test
    @DisplayName("the whole list is rewritten, so a link left out of it is gone")
    void theSocialLinkListIsRewrittenWhole() {
        Account owner = registered("rewrite");
        patch(
                owner,
                """
                {"socialLinks": [
                  {"platform": "INSTAGRAM", "url": "https://instagram.com/one"},
                  {"platform": "YOUTUBE", "url": "https://youtube.com/@one"}
                ]}
                """);

        // The same platform with a different address, and the other one omitted. A
        // reconciliation that tried to be clever would leave YouTube behind; a rewrite does
        // not, and the unique index on (user_id, platform) is what makes the delete-then-insert
        // ordering load-bearing rather than incidental.
        Map<String, Object> body = parse(patch(
                owner,
                "{\"socialLinks\": [{\"platform\": \"INSTAGRAM\", \"url\": \"https://instagram.com/two\"}]}"));

        assertThat(body.get("socialLinks"))
                .isEqualTo(List.of(Map.of("platform", "INSTAGRAM", "url", "https://instagram.com/two")));
    }

    // -----------------------------------------------------------------------
    // What it refuses
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a link that is not https is refused, and the refusal names the field")
    void aNonHttpsLinkIsRefused() {
        Account owner = registered("scheme");

        // The scheme is the whole of the exploit: this string in an href on a public profile
        // is stored cross-site scripting.
        assertRefuses(patch(owner, "{\"websiteUrl\": \"javascript:alert(1)\"}"), "websiteUrl");
        assertRefuses(patch(owner, "{\"websiteUrl\": \"http://plain.example.com\"}"), "websiteUrl");
        assertRefuses(patch(owner, "{\"avatarUrl\": \"data:image/png;base64,AAAA\"}"), "avatarUrl");
        assertRefuses(
                patch(owner, "{\"socialLinks\": [{\"platform\": \"X\", \"url\": \"http://x.com/somebody\"}]}"),
                "socialLinks");

        // Refused, not normalised. Nothing was written on the way to any of those 400s.
        Map<String, Object> body = parse(readProfile(owner));
        assertThat(body.get("websiteUrl")).isNull();
        assertThat(body.get("avatarUrl")).isNull();
        assertThat(body.get("socialLinks")).isEqualTo(List.of());
    }

    @Test
    @DisplayName("a location slug naming nothing is refused rather than dropped")
    void anUnknownLocationSlugIsRefused() {
        Account owner = registered("gazetteer");

        ResponseEntity<String> response = patch(owner, "{\"locationSlug\": \"atlantis\"}");
        assertRefuses(response, "locationSlug");
        // The message says which place, because the person can act on that and cannot act on
        // "invalid input".
        assertThat(parse(response).get("detail").toString()).contains("atlantis");

        assertThat(parse(readProfile(owner)).get("location")).isNull();
    }

    @Test
    @DisplayName("the per-account link cap is enforced, and so is one link per platform")
    void theSocialLinkCapIsEnforced() {
        Account owner = registered("cap");

        // Six, against a cap of five. The cap is a product decision and lives in
        // ProfileEditing rather than in a CHECK constraint -- V46 argues the split -- so this
        // is the only place it is enforced and the only place it can be asserted.
        assertRefuses(
                patch(
                        owner,
                        """
                        {"socialLinks": [
                          {"platform": "INSTAGRAM", "url": "https://instagram.com/a"},
                          {"platform": "FACEBOOK", "url": "https://facebook.com/a"},
                          {"platform": "X", "url": "https://x.com/a"},
                          {"platform": "YOUTUBE", "url": "https://youtube.com/@a"},
                          {"platform": "TIKTOK", "url": "https://tiktok.com/@a"},
                          {"platform": "LINKEDIN", "url": "https://linkedin.com/in/a"}
                        ]}
                        """),
                "socialLinks");

        // Two of one platform. The unique index refuses it one layer down; refusing it here is
        // what makes it a sentence instead of a 500.
        assertRefuses(
                patch(
                        owner,
                        """
                        {"socialLinks": [
                          {"platform": "INSTAGRAM", "url": "https://instagram.com/a"},
                          {"platform": "INSTAGRAM", "url": "https://instagram.com/b"}
                        ]}
                        """),
                "socialLinks");

        // A platform the vocabulary does not have is refused by the binding, before any
        // handler runs -- the route ProfileVisibilityRequest takes.
        assertThat(patch(owner, "{\"socialLinks\": [{\"platform\": \"MYSPACE\", \"url\": \"https://myspace.com/a\"}]}")
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        assertThat(parse(readProfile(owner)).get("socialLinks")).isEqualTo(List.of());
    }

    @Test
    @DisplayName("a name outside the column's bounds is a 400 naming the field, not a 500 from the database")
    void aNameOutsideItsBoundsIsRefused() {
        Account owner = registered("naming");

        assertRefuses(patch(owner, "{\"name\": \"   \"}"), "name");
        assertRefuses(patch(owner, "{\"name\": \"" + "x".repeat(81) + "\"}"), "name");
        // users.name is NOT NULL, so this is the one field a patch cannot clear.
        assertRefuses(patch(owner, "{\"name\": null}"), "name");

        assertThat(parse(readProfile(owner)).get("name")).isEqualTo("Test naming");
    }

    @Test
    @DisplayName("the slug is readable and is not writable")
    void theSlugIsNotWritable() {
        Account owner = registered("slug");

        // /u/{slug} is this profile's public address and is linked from every campaign page
        // the account has published. There is no `slug` on the request record at all, so the
        // key is ignored rather than refused -- and the assertion is that the address did not
        // move, which is the property that matters to everybody holding a link to it.
        ResponseEntity<String> response = patch(owner, "{\"slug\": \"something-else\", \"bio\": \"Hello.\"}");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(parse(response).get("slug")).isEqualTo(owner.slug());
        assertThat(jdbc().queryForObject("SELECT slug FROM users WHERE id = ?", String.class, owner.id()))
                .isEqualTo(owner.slug());
    }

    @Test
    @DisplayName("one account's patch reaches only its own profile")
    void anotherAccountCannotWriteYourProfile() {
        Account mine = registered("mine");
        Account theirs = registered("theirs");
        patch(mine, "{\"bio\": \"Mine, and it stays mine.\"}");

        // There is no path by which a request can name an account: the subject comes from a
        // signature we made, never from the body. So the test is that the obvious attempt --
        // sending somebody else's identifier and slug alongside the change -- moves nothing but
        // the caller's own row.
        ResponseEntity<String> response = patch(
                theirs,
                "{\"id\": \"" + mine.id() + "\", \"slug\": \"" + mine.slug() + "\", \"bio\": \"Overwritten.\"}");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(parse(response).get("slug")).isEqualTo(theirs.slug());
        assertThat(jdbc().queryForObject("SELECT bio FROM users WHERE id = ?", String.class, mine.id()))
                .isEqualTo("Mine, and it stays mine.");
    }

    // -----------------------------------------------------------------------
    // The public page, and §17.4
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the public profile carries the new fields, and its validator moves when one of them does")
    void thePublicProfileCarriesTheNewFieldsAndItsEtagFollowsThem() {
        Account owner = registered("public");
        patch(
                owner,
                """
                {
                  "websiteUrl": "https://somebody.example.com",
                  "locationSlug": "baki",
                  "socialLinks": [{"platform": "BEHANCE", "url": "https://behance.net/somebody"}]
                }
                """);

        ResponseEntity<String> first = rest.getForEntity("/v1/users/" + owner.slug(), String.class);
        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> page = parse(first);
        assertThat(page.get("websiteUrl")).isEqualTo("https://somebody.example.com");
        assertThat(page.get("location")).isEqualTo(Map.of("slug", KNOWN_LOCATION, "name", "Bakı"));
        assertThat(page.get("socialLinks"))
                .isEqualTo(List.of(Map.of("platform", "BEHANCE", "url", "https://behance.net/somebody")));

        String etag = first.getHeaders().getETag();
        assertThat(etag).isNotNull();

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(etag);
        assertThat(rest.exchange(
                                "/v1/users/" + owner.slug(),
                                HttpMethod.GET,
                                new HttpEntity<>(conditional),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_MODIFIED);

        // The tag is a digest over a hand-written canonical form, so a field that was added to
        // the response and forgotten there would answer 304 to somebody revalidating a page
        // that had changed -- and the page would keep showing an address its owner deleted.
        // Changing only a link is the case a canonical form written before #276 would miss.
        patch(owner, "{\"socialLinks\": [{\"platform\": \"BEHANCE\", \"url\": \"https://behance.net/moved\"}]}");
        ResponseEntity<String> changed = rest.exchange(
                "/v1/users/" + owner.slug(), HttpMethod.GET, new HttpEntity<>(conditional), String.class);
        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(changed.getHeaders().getETag()).isNotEqualTo(etag);
    }

    @Test
    @DisplayName("anonymisation takes the whole profile, including the links")
    void anonymisationTakesTheWholeProfileIncludingTheLinks() {
        Account owner = registered("erased");
        patch(
                owner,
                """
                {
                  "bio": "Something identifying.",
                  "avatarUrl": "https://cdn.example.com/face.jpg",
                  "websiteUrl": "https://somebody.example.com",
                  "locationSlug": "baki",
                  "socialLinks": [{"platform": "INSTAGRAM", "url": "https://instagram.com/somebody"}]
                }
                """);

        deletions.request(owner.id(), PASSWORD);
        assertThat(anonymiser.anonymise(owner.id(), Instant.now().plus(AFTER_THE_GRACE_PERIOD)))
                .isTrue();

        Map<String, Object> row = jdbc()
                .queryForMap(
                        "SELECT bio, avatar_url, website_url, location_id FROM users WHERE id = ?", owner.id());
        assertThat(row.get("bio")).isNull();
        assertThat(row.get("avatar_url")).isNull();
        assertThat(row.get("website_url")).isNull();
        assertThat(row.get("location_id")).isNull();

        // The one that does not fall out of clearing columns. These are rows in a table the
        // `users` entity does not map, ON DELETE CASCADE never fires because the row is never
        // hard-deleted, and a link to somebody's account elsewhere identifies them more
        // directly than the name above it -- it resolves to a page with their photograph on it.
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM user_social_links WHERE user_id = ?", Integer.class, owner.id()))
                .isZero();

        // Repeatable, which is what makes the job safe to re-run after a crash.
        assertThat(anonymiser.anonymise(owner.id(), Instant.now().plus(AFTER_THE_GRACE_PERIOD)))
                .isFalse();
    }

    @Test
    @DisplayName("the export carries the profile, or it is not a complete export")
    void theExportCarriesTheProfile() {
        Account owner = registered("export");
        patch(
                owner,
                """
                {
                  "websiteUrl": "https://exported.example.com",
                  "locationSlug": "gence",
                  "socialLinks": [{"platform": "TELEGRAM", "url": "https://t.me/exported"}]
                }
                """);

        ResponseEntity<String> export = rest.exchange(
                "/v1/me/export", HttpMethod.GET, new HttpEntity<>(bearer(owner.accessToken())), String.class);

        assertThat(export.getStatusCode()).isEqualTo(HttpStatus.OK);
        // The slug rather than the identifier: a uuid means nothing in a file somebody opens
        // two years later.
        assertThat(export.getBody())
                .contains("\"websiteUrl\":\"https://exported.example.com\"")
                .contains("\"location\":\"gence\"")
                .contains("\"platform\":\"TELEGRAM\"")
                .contains("\"url\":\"https://t.me/exported\"");
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

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

        Map<String, Object> account = jdbc().queryForMap("SELECT id, slug FROM users WHERE email = ?::citext", email);
        return new Account(
                (String) signedIn.get("accessToken"), (UUID) account.get("id"), (String) account.get("slug"));
    }

    // -----------------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------------

    private ResponseEntity<String> readProfile(Account owner) {
        return rest.exchange(
                "/v1/me/profile", HttpMethod.GET, new HttpEntity<>(bearer(owner.accessToken())), String.class);
    }

    private ResponseEntity<String> patch(Account owner, String body) {
        return rest.exchange(
                "/v1/me/profile", HttpMethod.PATCH, new HttpEntity<>(body, bearer(owner.accessToken())), String.class);
    }

    private ResponseEntity<String> setVisibility(Account owner, String visibility) {
        return rest.exchange(
                "/v1/me/profile-visibility",
                HttpMethod.PATCH,
                new HttpEntity<>("{\"visibility\":\"" + visibility + "\"}", bearer(owner.accessToken())),
                String.class);
    }

    private ResponseEntity<String> patchAnonymously(String body) {
        return rest.exchange(
                "/v1/me/profile", HttpMethod.PATCH, new HttpEntity<>(body, jsonHeaders()), String.class);
    }

    /** 400, RFC 9457, and the field named in {@code meta} so an editor can highlight the input. */
    private void assertRefuses(ResponseEntity<String> response, String field) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> problem = parse(response);
        assertThat(problem.get("code")).isEqualTo("PROFILE_FIELD_INVALID");
        assertThat(problem.get("meta")).isEqualTo(Map.of("field", field));
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

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(ResponseEntity<String> response) {
        try {
            return json.readValue(response.getBody(), Map.class);
        } catch (Exception e) {
            throw new IllegalStateException("Not a JSON object: " + response.getBody(), e);
        }
    }
}
