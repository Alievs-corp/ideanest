package az.ideanest.pledgemanager;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
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
 * §4.8's PM-20 to PM-22 (#80): the tracking import, and both sides reading it.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aBadRowIsReportedAndTheRestOfTheFileStillLands()} — the decision the
 *       whole import is shaped around. A creator with four thousand parcels and one
 *       typo must not be sent away with nothing.
 *   <li>{@link #reimportingTheSameFileChangesNothing()} — re-uploading last week's
 *       spreadsheet with fifty new lines is how this endpoint is actually used.
 *   <li>{@link #aCorrectionClearsTheInstantItContradicts()} — V38's constraint, from
 *       the outside: a parcel put back to shipped has no delivery instant.
 *   <li>{@link #aTrackingNumberWithoutACarrierIsRefused()} — a number nobody can look
 *       up is worse than none.
 *   <li>{@link #aBackerSeesOnlyTheirOwnParcels()} — the read that would otherwise be a
 *       fulfilment list for anybody holding a pledge identifier.
 * </ul>
 */
class FulfilmentApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM fulfilments");
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // The import
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a creator imports tracking numbers and reads the parcels back")
    void aCreatorImportsTracking() {
        Account creator = account("ff-creator");
        UUID project = liveCampaign(creator);
        UUID first = pledgeFor(project, account("ff-backer").id());
        UUID second = pledgeFor(project, account("ff-backer").id());

        ResponseEntity<Map<String, Object>> imported = importFile(
                project,
                creator,
                """
                pledge_id,status,carrier,tracking_number,tracking_url
                %s,SHIPPED,Azerpoct,AZ123456789,https://track.example.com/AZ123456789
                %s,PREPARING,,,
                """
                        .formatted(first, second));

        assertThat(imported.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(imported.getBody()).containsEntry("rows", 2).containsEntry("changed", 2).containsEntry("failed", 0);

        ResponseEntity<Map<String, Object>> list = list(project, creator);
        assertThat(list.getHeaders().getCacheControl())
                .as("where several thousand parcels went is not something a shared cache should hold")
                .contains("no-store");

        Map<String, Object> shipped = rowFor(list.getBody(), first);
        assertThat(shipped).containsEntry("status", "SHIPPED").containsEntry("carrier", "Azerpoct");
        assertThat(shipped.get("shippedAt")).as("a shipped parcel has left").isNotNull();
        assertThat(shipped.get("deliveredAt")).isNull();

        Map<String, Object> progress = progressOf(list.getBody());
        assertThat(progress)
                .containsEntry("backings", 2)
                .containsEntry("shipped", 1)
                .containsEntry("preparing", 1)
                .containsEntry("untouched", 0);
    }

    @Test
    @DisplayName("a bad row is reported with its line number and the rest of the file still lands")
    void aBadRowIsReportedAndTheRestOfTheFileStillLands() {
        Account creator = account("ff-partial");
        UUID project = liveCampaign(creator);
        UUID good = pledgeFor(project, account("ff-partial-backer").id());
        UUID elsewhere = pledgeFor(liveCampaign(account("ff-other-creator")), account("ff-other-backer").id());

        ResponseEntity<Map<String, Object>> imported = importFile(
                project,
                creator,
                """
                pledge_id,status,carrier,tracking_number
                %s,SHIPPED,DHL,DH1
                not-a-uuid,SHIPPED,DHL,DH2
                %s,SHIPPED,DHL,DH3
                %s,BEING_THOUGHT_ABOUT,DHL,DH4
                """
                        .formatted(good, elsewhere, good));

        assertThat(imported.getStatusCode())
                .as("the request succeeded; what happened to each row is in the body")
                .isEqualTo(HttpStatus.OK);
        assertThat(imported.getBody()).containsEntry("rows", 4).containsEntry("changed", 1).containsEntry("failed", 3);

        List<Map<String, Object>> errors = errorsOf(imported.getBody());
        assertThat(errors).hasSize(3);
        assertThat(errors.get(0)).containsEntry("line", 3).containsEntry("code", "FULFILMENT_ROW_PLEDGE_INVALID");
        assertThat(errors.get(1)).containsEntry("line", 4).containsEntry("code", "FULFILMENT_ROW_PLEDGE_NOT_BACKING");
        assertThat(errors.get(2))
                .as("the same pledge twice in one file is two claims about one parcel")
                .containsEntry("line", 5)
                .containsEntry("code", "FULFILMENT_ROW_DUPLICATE");

        assertThat(rowFor(list(project, creator).getBody(), good)).containsEntry("trackingNumber", "DH1");
    }

    @Test
    @DisplayName("re-importing the same file changes nothing")
    void reimportingTheSameFileChangesNothing() {
        Account creator = account("ff-repeat");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-repeat-backer").id());
        String file =
                """
                pledge_id,status,carrier,tracking_number
                %s,SHIPPED,DHL,DH9
                """
                        .formatted(pledge);

        importFile(project, creator, file);
        ResponseEntity<Map<String, Object>> again = importFile(project, creator, file);

        // The ordinary use of this endpoint is a spreadsheet with fifty new lines
        // added to last week's. Restamping four thousand rows would make `updatedAt`
        // -- which is what a creator sorts by -- meaningless.
        assertThat(again.getBody()).containsEntry("changed", 0).containsEntry("unchanged", 1);
    }

    @Test
    @DisplayName("a blank status with a tracking number means the parcel shipped")
    void aBlankStatusWithTrackingMeansShipped() {
        Account creator = account("ff-blank");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-blank-backer").id());

        // The file a fulfilment partner returns has a tracking column and frequently
        // no status column at all.
        importFile(
                project,
                creator,
                """
                pledge_id,carrier,tracking_number
                %s,UPS,1Z999
                """
                        .formatted(pledge));

        assertThat(rowFor(list(project, creator).getBody(), pledge)).containsEntry("status", "SHIPPED");
    }

    @Test
    @DisplayName("a row with nothing on it but a pledge is refused rather than guessed at")
    void aRowWithNoStatusAndNoTrackingIsRefused() {
        Account creator = account("ff-empty-row");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-empty-row-backer").id());

        ResponseEntity<Map<String, Object>> imported = importFile(
                project,
                creator,
                """
                pledge_id,status,carrier,tracking_number
                %s,,,
                """
                        .formatted(pledge));

        assertThat(imported.getBody()).containsEntry("failed", 1);
        assertThat(errorsOf(imported.getBody()).getFirst()).containsEntry("code", "FULFILMENT_ROW_STATUS_MISSING");
    }

    @Test
    @DisplayName("a tracking number without a carrier is refused")
    void aTrackingNumberWithoutACarrierIsRefused() {
        Account creator = account("ff-carrier");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-carrier-backer").id());

        ResponseEntity<Map<String, Object>> imported = importFile(
                project,
                creator,
                """
                pledge_id,status,tracking_number
                %s,SHIPPED,ZZ1
                """
                        .formatted(pledge));

        // A bare number is a string nobody can look up, and a backer shown one spends
        // an evening pasting it into the wrong carrier's website.
        assertThat(errorsOf(imported.getBody()).getFirst()).containsEntry("code", "FULFILMENT_ROW_TRACKING_INVALID");
    }

    @Test
    @DisplayName("an http tracking link is refused")
    void anInsecureTrackingLinkIsRefused() {
        Account creator = account("ff-url");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-url-backer").id());

        ResponseEntity<Map<String, Object>> imported = importFile(
                project,
                creator,
                """
                pledge_id,status,carrier,tracking_number,tracking_url
                %s,SHIPPED,DHL,DH1,http://track.example.com/DH1
                """
                        .formatted(pledge));

        assertThat(errorsOf(imported.getBody()).getFirst()).containsEntry("code", "FULFILMENT_ROW_TRACKING_INVALID");
    }

    @Test
    @DisplayName("a correction clears the instant it contradicts")
    void aCorrectionClearsTheInstantItContradicts() {
        Account creator = account("ff-correct");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-correct-backer").id());

        importFile(
                project,
                creator,
                """
                pledge_id,status,carrier,tracking_number
                %s,DELIVERED,DHL,DH7
                """
                        .formatted(pledge));
        assertThat(rowFor(list(project, creator).getBody(), pledge).get("deliveredAt"))
                .isNotNull();

        importFile(
                project,
                creator,
                """
                pledge_id,status,carrier,tracking_number
                %s,SHIPPED,DHL,DH7
                """
                        .formatted(pledge));

        Map<String, Object> corrected = rowFor(list(project, creator).getBody(), pledge);
        assertThat(corrected).containsEntry("status", "SHIPPED");
        assertThat(corrected.get("deliveredAt"))
                .as("a delivery instant on a parcel that has not been delivered is what a backer would believe")
                .isNull();
        assertThat(corrected.get("shippedAt"))
                .as("it did leave, and the first claim about that stands")
                .isNotNull();
    }

    @Test
    @DisplayName("a file with no pledge_id column is refused as a whole")
    void aFileWithoutThePledgeColumnIsRefused() {
        Account creator = account("ff-header");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused = importFile(
                project,
                creator,
                """
                backer_email,status
                somebody@example.com,SHIPPED
                """);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "FULFILMENT_IMPORT_NO_PLEDGE_COLUMN");
    }

    @Test
    @DisplayName("columns the import does not understand are ignored rather than refused")
    void unknownColumnsAreIgnored() {
        Account creator = account("ff-extra");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-extra-backer").id());

        // The file a fulfilment partner returns has their own references, weights and
        // dates in it, and quoted commas in the columns this ignores.
        ResponseEntity<Map<String, Object>> imported = importFile(
                project,
                creator,
                """
                pledge_id,partner_reference,address,status,carrier,tracking_number,weight_kg
                %s,REF-1,"12 Nizami street, Flat 4",SHIPPED,DHL,DH2,1.4
                """
                        .formatted(pledge));

        assertThat(imported.getBody()).containsEntry("changed", 1).containsEntry("failed", 0);
        assertThat(rowFor(list(project, creator).getBody(), pledge)).containsEntry("trackingNumber", "DH2");
    }

    // ------------------------------------------------------------------
    // Who may read what
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a backer sees only their own parcels")
    void aBackerSeesOnlyTheirOwnParcels() {
        Account creator = account("ff-mine-creator");
        UUID project = liveCampaign(creator);
        Account mine = account("ff-mine");
        Account theirs = account("ff-theirs");
        UUID myPledge = pledgeFor(project, mine.id());
        UUID theirPledge = pledgeFor(project, theirs.id());

        importFile(
                project,
                creator,
                """
                pledge_id,status,carrier,tracking_number
                %s,SHIPPED,DHL,MINE
                %s,SHIPPED,DHL,THEIRS
                """
                        .formatted(myPledge, theirPledge));

        ResponseEntity<Map<String, Object>> mineList =
                exchange("/v1/me/fulfilments", HttpMethod.GET, mine.accessToken(), null);

        List<Map<String, Object>> items = itemsOf(mineList.getBody());
        assertThat(items).hasSize(1);
        assertThat(fulfilmentOf(items.getFirst())).containsEntry("trackingNumber", "MINE");
        assertThat(items.getFirst().get("projectTitle"))
                .as("a list of pledge identifiers is a list nobody can read")
                .isNotNull();
    }

    @Test
    @DisplayName("a pledge the creator has said nothing about is absent rather than invented as preparing")
    void aPledgeWithNoRowIsAbsentFromTheBackersList() {
        Account creator = account("ff-silent-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("ff-silent-backer");
        pledgeFor(project, backer.id());

        ResponseEntity<Map<String, Object>> mine =
                exchange("/v1/me/fulfilments", HttpMethod.GET, backer.accessToken(), null);

        assertThat(itemsOf(mine.getBody())).isEmpty();
    }

    @Test
    @DisplayName("somebody with no part in the campaign cannot import or read its parcels")
    void aStrangerCannotTouchTheCampaignsFulfilment() {
        Account creator = account("ff-guard-creator");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-guard-backer").id());
        Account stranger = account("ff-stranger");

        ResponseEntity<Map<String, Object>> imported = importFile(
                project,
                stranger,
                """
                pledge_id,status,carrier,tracking_number
                %s,SHIPPED,DHL,DH1
                """
                        .formatted(pledge));

        // The same 404 a confidential campaign gets: somebody with no part in it does
        // not learn whether it exists.
        assertThat(imported.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(list(project, stranger).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("an import is audited with counts and no tracking number")
    void anImportIsAudited() {
        Account creator = account("ff-audit");
        UUID project = liveCampaign(creator);
        UUID pledge = pledgeFor(project, account("ff-audit-backer").id());

        importFile(
                project,
                creator,
                """
                pledge_id,status,carrier,tracking_number
                %s,SHIPPED,DHL,SECRET-NUMBER
                """
                        .formatted(pledge));

        List<AuditEntry> rows = auditRows(project, AuditAction.PROJECT_FULFILMENTS_IMPORTED);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().getDetail()).contains("rows=1", "changed=1", "failed=0");
        assertThat(rows.getFirst().getDetail())
                .as("audit_logs has no retention rule; where a parcel went does not belong in it")
                .doesNotContain("SECRET-NUMBER");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    private UUID liveCampaign(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign that ships things " + SEQUENCE.incrementAndGet()));
        UUID project = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, project);
        return project;
    }

    /**
     * A confirmed backing, written directly.
     *
     * <p>{@code Campaigns} argues why: this suite is about parcels, and driving every
     * fixture through checkout would make each of its tests depend on reward tiers,
     * reservations and a rate limiter none of them is about.
     */
    private UUID pledgeFor(UUID project, UUID backerId) {
        UUID pledgeId = Identifiers.newIdentifier();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges
                            (id, project_id, backer_id, state, base_amount, shipping_country, confirmed_at)
                        VALUES (?, ?, ?, 'COLLECTED', 25.00, 'AZ', now())
                        """,
                        pledgeId,
                        project,
                        backerId);
        return pledgeId;
    }

    private ResponseEntity<Map<String, Object>> importFile(UUID project, Account caller, String document) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/csv"));
        headers.setBearerAuth(caller.accessToken());
        return rest.exchange(
                "/v1/projects/" + project + "/fulfilments/import",
                HttpMethod.POST,
                new HttpEntity<>(document, headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> list(UUID project, Account caller) {
        return exchange("/v1/projects/" + project + "/fulfilments", HttpMethod.GET, caller.accessToken(), null);
    }

    private List<AuditEntry> auditRows(UUID project, AuditAction action) {
        // Filtered to this campaign: `audit_logs` refuses DELETE by design (V21), so
        // the table carries every other test's rows too.
        return auditEntries.findAll().stream()
                .filter(entry -> entry.getAction().equals(action.action()))
                .filter(entry -> project.equals(entry.getEntityId()))
                .toList();
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rowsOf(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("fulfilments");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> progressOf(Map<String, Object> body) {
        return (Map<String, Object>) body.get("progress");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> errorsOf(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("errors");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> itemsOf(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("fulfilments");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> fulfilmentOf(Map<String, Object> item) {
        return (Map<String, Object>) item.get("fulfilment");
    }

    private static Map<String, Object> rowFor(Map<String, Object> body, UUID pledgeId) {
        return rowsOf(body).stream()
                .filter(row -> pledgeId.toString().equals(row.get("pledgeId")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No parcel for pledge " + pledgeId));
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
}
