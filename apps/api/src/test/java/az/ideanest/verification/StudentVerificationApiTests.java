package az.ideanest.verification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.application.AccountAnonymiser;
import az.ideanest.user.application.AccountDeletionService;
import az.ideanest.user.infrastructure.UserRepository;
import az.ideanest.verification.application.StudentDocumentRetentionJob;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/**
 * Student verification over HTTP — #655.
 *
 * <p>The ones that carry the design: {@link #oneCardIsOneAccount()} and
 * {@link #twoAccountsRacingForOneCardGetOneEach()} — the owner's "one card number, one account",
 * held by the service and, when two submissions arrive together, by V127's index;
 * {@link #anExpiredApprovalFreesTheCard()} — the index cannot read a clock, so an expired
 * approval must not hold a card for ever; {@link #openingAPhotographIsAuditedAndStaffOnly()}; and
 * {@link #aDecisionErasesThePhotographs()}.
 */
class StudentVerificationApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

    private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x00, 0x11};
    private static final byte[] PNG = {
        (byte) 0x89, 'P', 'N', 'G', (byte) 0x0D, (byte) 0x0A, (byte) 0x1A, (byte) 0x0A, 0x00
    };
    private static final byte[] PDF = {'%', 'P', 'D', 'F', '-', '1', '.', '7'};

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private StudentDocumentRetentionJob retention;

    @Autowired
    private AccountDeletionService deletions;

    @Autowired
    private AccountAnonymiser anonymiser;

    @AfterEach
    void clear() {
        jdbc().update("DELETE FROM student_verifications");
    }

    // ------------------------------------------------------------------
    // The creator's side
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an account that never submitted reads NONE, not a 404")
    void neverSubmittedIsNone() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> mine = get("/v1/me/student-verification", creator.accessToken());

        assertThat(mine.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(mine.getHeaders().getCacheControl()).contains("no-store");
        assertThat(mine.getBody()).containsEntry("state", "NONE").doesNotContainKey("cardNumber");
    }

    @Test
    @DisplayName("a submission is pending, with its card number normalised, and both photographs sealed")
    void aSubmissionIsPending() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> submitted = submit(creator, "  Bakı Dövlət Universiteti ", "ab-12 345", PDF, PNG);

        assertThat(submitted.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(submitted.getBody())
                .containsEntry("state", "PENDING")
                .containsEntry("institution", "Bakı Dövlət Universiteti")
                .containsEntry("cardNumber", "AB12345")
                .containsKey("submittedAt")
                .doesNotContainKey("validUntil");
        assertThat(jdbc().queryForList(
                        """
                        SELECT d.kind || ':' || d.content_type FROM student_verification_documents d
                          JOIN student_verifications v ON v.id = d.verification_id
                         WHERE v.account_id = ? ORDER BY d.kind
                        """,
                        String.class,
                        creator.id()))
                .containsExactly("SELFIE:image/png", "STUDENT_CARD:application/pdf");
        // Ciphertext, never the bytes that were sent.
        byte[] stored = jdbc().queryForObject(
                """
                SELECT d.ciphertext FROM student_verification_documents d
                  JOIN student_verifications v ON v.id = d.verification_id
                 WHERE v.account_id = ? AND d.kind = 'SELFIE'
                """,
                byte[].class,
                creator.id());
        assertThat(stored).isNotEqualTo(PNG);
        assertThat(get("/v1/me/student-verification", creator.accessToken()).getBody()).containsEntry("state", "PENDING");
        assertThat(audited(creator.id(), "student.verification_submitted")).isEqualTo(1);
    }

    @Test
    @DisplayName("a browser's form, whose text parts carry no content type, is read as UTF-8")
    void aBrowsersFormIsReadAsUtf8() throws Exception {
        Account creator = account();
        String boundary = "----ideanest" + UUID.randomUUID();
        java.io.ByteArrayOutputStream body = new java.io.ByteArrayOutputStream();
        textPart(body, boundary, "institution", "Bakı Dövlət Universiteti");
        textPart(body, boundary, "cardNumber", "əb-77 1");
        filePart(body, boundary, "studentCard", JPEG);
        filePart(body, boundary, "selfie", PNG);
        ascii(body, "--" + boundary + "--" + CRLF);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("multipart/form-data; boundary=" + boundary));
        headers.setBearerAuth(creator.accessToken());

        ResponseEntity<Map<String, Object>> submitted = rest.exchange(
                "/v1/me/student-verification", HttpMethod.POST, new HttpEntity<>(body.toByteArray(), headers), mapType());

        assertThat(submitted.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(submitted.getBody())
                .containsEntry("institution", "Bakı Dövlət Universiteti")
                .containsEntry("cardNumber", "ƏB771");
    }

    private static final String CRLF = "\r\n";

    /** A text field as a browser's FormData sends it: no Content-Type, UTF-8 bytes. */
    private static void textPart(java.io.ByteArrayOutputStream body, String boundary, String name, String value)
            throws java.io.IOException {
        ascii(body, "--" + boundary + CRLF + "Content-Disposition: form-data; name=\"" + name + "\"" + CRLF + CRLF);
        body.write(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        ascii(body, CRLF);
    }

    private static void filePart(java.io.ByteArrayOutputStream body, String boundary, String name, byte[] content)
            throws java.io.IOException {
        ascii(body, "--" + boundary + CRLF + "Content-Disposition: form-data; name=\"" + name + "\"; filename=\""
                + name + ".bin\"" + CRLF + "Content-Type: application/octet-stream" + CRLF + CRLF);
        body.write(content);
        ascii(body, CRLF);
    }

    private static void ascii(java.io.ByteArrayOutputStream body, String text) throws java.io.IOException {
        body.write(text.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
    }

    @Test
    @DisplayName("a second submission while one is pending or approved is refused")
    void oneOpenCheckPerAccount() {
        Account creator = account();
        submit(creator, "BDU", "CARD-1", JPEG, JPEG);

        ResponseEntity<Map<String, Object>> again = submit(creator, "BDU", "CARD-2", JPEG, JPEG);

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "STUDENT_VERIFICATION_ALREADY_SUBMITTED");
    }

    @Test
    @DisplayName("one card number is one account: another account submitting it, however typed, is refused")
    void oneCardIsOneAccount() {
        Account first = account();
        Account second = account();
        submit(first, "BDU", "AZ 2024-777", JPEG, JPEG);

        ResponseEntity<Map<String, Object>> refused = submit(second, "ADA", "az2024777", JPEG, JPEG);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "STUDENT_CARD_IN_USE");
        // Nothing about whose it is.
        assertThat(String.valueOf(refused.getBody())).doesNotContain(first.id().toString());

        // Approved there: still refused. Refused there: free again.
        UUID id = idOf(first);
        assertThat(post("/v1/admin/student-verifications/" + id + "/approve", admin().accessToken(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(submit(second, "ADA", "AZ2024777", JPEG, JPEG).getBody()).containsEntry("code", "STUDENT_CARD_IN_USE");
        post("/v1/admin/student-verifications/" + id + "/revoke", admin().accessToken(), Map.of("reason", "Not theirs"));
        assertThat(submit(second, "ADA", "AZ2024777", JPEG, JPEG).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("two accounts racing for one card get one submission between them, and the index decides")
    void twoAccountsRacingForOneCardGetOneEach() throws Exception {
        List<Account> racers = List.of(account(), account(), account());
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(racers.size());
        try {
            List<Future<ResponseEntity<Map<String, Object>>>> answers = new ArrayList<>();
            for (Account racer : racers) {
                Callable<ResponseEntity<Map<String, Object>>> attempt = () -> {
                    start.await();
                    return submit(racer, "BDU", "RACE-0001", JPEG, JPEG);
                };
                answers.add(pool.submit(attempt));
            }
            start.countDown();

            List<Object> outcomes = new ArrayList<>();
            for (Future<ResponseEntity<Map<String, Object>>> answer : answers) {
                ResponseEntity<Map<String, Object>> response = answer.get(60, TimeUnit.SECONDS);
                outcomes.add(response.getStatusCode() == HttpStatus.OK ? "OK" : response.getBody().get("code"));
            }
            assertThat(outcomes).containsOnlyOnce("OK");
            assertThat(outcomes).filteredOn(outcome -> !"OK".equals(outcome)).containsOnly("STUDENT_CARD_IN_USE");
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM student_verifications WHERE card_number = 'RACE0001'", Long.class))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("V127's index refuses a second open row for a card even to a writer that skips the service")
    void theIndexHoldsTheRule() {
        Account first = account();
        Account second = account();
        insertRow(first.id(), "INDEX123", "PENDING", null);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> insertRow(second.id(), "INDEX123", "APPROVED",
                        Instant.now().plus(Duration.ofDays(1))))
                .isInstanceOf(DataIntegrityViolationException.class);
        // A refused or expired row does not hold it.
        insertRow(second.id(), "INDEX123", "REJECTED", null);
    }

    @Test
    @DisplayName("an expired approval frees the card for another account, and lets its own account submit again")
    void anExpiredApprovalFreesTheCard() {
        Account first = account();
        Account second = account();
        submit(first, "BDU", "EXP-42", JPEG, JPEG);
        UUID id = idOf(first);
        post("/v1/admin/student-verifications/" + id + "/approve", admin().accessToken(), Map.of());
        jdbc().update(
                "UPDATE student_verifications SET valid_until = ? WHERE id = ?",
                Timestamp.from(Instant.now().minusSeconds(1)),
                id);

        assertThat(get("/v1/me/student-verification", first.accessToken()).getBody()).containsEntry("state", "EXPIRED");

        ResponseEntity<Map<String, Object>> taken = submit(second, "ADA", "exp42", JPEG, JPEG);
        assertThat(taken.getStatusCode()).isEqualTo(HttpStatus.OK);
        // Retired by the submission it stood in the way of.
        assertThat(jdbc().queryForObject("SELECT state FROM student_verifications WHERE id = ?", String.class, id))
                .isEqualTo("EXPIRED");

        // The first account may submit again, with a card of its own.
        assertThat(submit(first, "BDU", "EXP-43", JPEG, JPEG).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("each photograph is checked, and a refusal names the part")
    void photographsAreChecked() {
        Account creator = account();

        assertThat(submit(creator, "BDU", "PHOTO-1", JPEG, PDF).getBody())
                .containsEntry("code", "UNSUPPORTED_TYPE")
                .containsEntry("field", "selfie");
        assertThat(submit(creator, "BDU", "PHOTO-1", "not an image".getBytes(), JPEG).getBody())
                .containsEntry("code", "UNSUPPORTED_TYPE")
                .containsEntry("field", "studentCard");
        assertThat(submit(creator, "BDU", "PHOTO-1", JPEG, null).getBody())
                .containsEntry("code", "EMPTY")
                .containsEntry("field", "selfie");
        assertThat(submit(creator, "BDU", "PHOTO-1", new byte[0], JPEG).getBody())
                .containsEntry("code", "EMPTY")
                .containsEntry("field", "studentCard");
        assertThat(submit(creator, " ", "PHOTO-1", JPEG, JPEG).getBody())
                .containsEntry("code", "INVALID_STUDENT_VERIFICATION")
                .containsEntry("field", "institution");
        assertThat(submit(creator, "BDU", "--", JPEG, JPEG).getBody())
                .containsEntry("code", "INVALID_STUDENT_VERIFICATION")
                .containsEntry("field", "cardNumber");

        // None of them left a row.
        assertThat(get("/v1/me/student-verification", creator.accessToken()).getBody()).containsEntry("state", "NONE");
    }

    // ------------------------------------------------------------------
    // The staff side
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the queue lists pending submissions oldest first, with the account and every other account on the card")
    void theQueueShowsTheCardsHistory() {
        Account earlier = account();
        Account later = account();
        insertRow(earlier.id(), "SHARED99", "REJECTED", null);
        submit(later, "ADA", "shared-99", JPEG, JPEG);

        List<Map<String, Object>> queue = rows(get("/v1/admin/student-verifications", admin().accessToken()));

        Map<String, Object> row = queue.stream()
                .filter(entry -> later.id().toString().equals(entry.get("accountId")))
                .findFirst()
                .orElseThrow();
        assertThat(row)
                .containsEntry("state", "PENDING")
                .containsEntry("cardNumber", "SHARED99")
                .containsEntry("institution", "ADA")
                .containsEntry("accountName", "Test Student")
                .containsEntry("documents", List.of("STUDENT_CARD", "SELFIE"));
        assertThat((String) row.get("accountEmail")).startsWith("student-verify-");
        assertThat(row.get("sameCardElsewhere"))
                .isEqualTo(List.of(Map.of("accountId", earlier.id().toString(), "accountName", "Test Student", "state", "REJECTED")));
    }

    @Test
    @DisplayName("approving counts for a year and erases both photographs; refusing needs a reason and erases them too")
    void aDecisionErasesThePhotographs() {
        Account approved = account();
        Account refused = account();
        submit(approved, "BDU", "DECIDE-1", JPEG, JPEG);
        submit(refused, "BDU", "DECIDE-2", JPEG, JPEG);

        Map<String, Object> row =
                post("/v1/admin/student-verifications/" + idOf(approved) + "/approve", admin().accessToken(), Map.of())
                        .getBody();
        assertThat(row).containsEntry("state", "APPROVED").containsEntry("documents", List.of());
        Instant validUntil = Instant.parse((String) row.get("validUntil"));
        Instant decidedAt = Instant.parse((String) row.get("decidedAt"));
        assertThat(validUntil).isEqualTo(decidedAt.atOffset(java.time.ZoneOffset.UTC).plusYears(1).toInstant());
        assertThat(row.get("decidedBy")).isEqualTo(admin().id().toString());
        assertThat(documentsOf(approved)).isZero();
        assertThat(jdbc().queryForObject(
                        "SELECT documents_erased_at IS NOT NULL FROM student_verifications WHERE account_id = ?",
                        Boolean.class,
                        approved.id()))
                .isTrue();
        assertThat(audited(approved.id(), "student.verification_approved")).isEqualTo(1);
        assertThat(get("/v1/me/student-verification", approved.accessToken()).getBody())
                .containsEntry("state", "APPROVED")
                .containsKey("validUntil");

        ResponseEntity<Map<String, Object>> noReason = post(
                "/v1/admin/student-verifications/" + idOf(refused) + "/reject", admin().accessToken(), Map.of("reason", " "));
        assertThat(noReason.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(documentsOf(refused)).isEqualTo(2);

        Map<String, Object> rejected = post(
                        "/v1/admin/student-verifications/" + idOf(refused) + "/reject",
                        admin().accessToken(),
                        Map.of("reason", "The card is unreadable"))
                .getBody();
        assertThat(rejected).containsEntry("state", "REJECTED").containsEntry("rejectionReason", "The card is unreadable");
        assertThat(documentsOf(refused)).isZero();
        assertThat(audited(refused.id(), "student.verification_rejected")).isEqualTo(1);
        assertThat(get("/v1/me/student-verification", refused.accessToken()).getBody())
                .containsEntry("state", "REJECTED")
                .containsEntry("rejectionReason", "The card is unreadable");
    }

    @Test
    @DisplayName("a decision applies only to the state it is for, and an unknown submission is a 404")
    void decisionsAreChecked() {
        Account creator = account();
        submit(creator, "BDU", "STATE-1", JPEG, JPEG);
        UUID id = idOf(creator);

        assertThat(post("/v1/admin/student-verifications/" + id + "/revoke", admin().accessToken(), Map.of("reason", "x"))
                        .getBody())
                .containsEntry("code", "STUDENT_VERIFICATION_NOT_DECIDABLE");
        post("/v1/admin/student-verifications/" + id + "/approve", admin().accessToken(), Map.of());
        assertThat(post("/v1/admin/student-verifications/" + id + "/approve", admin().accessToken(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
        assertThat(post("/v1/admin/student-verifications/" + id + "/reject", admin().accessToken(), Map.of("reason", "x"))
                        .getBody())
                .containsEntry("code", "STUDENT_VERIFICATION_NOT_DECIDABLE");

        Map<String, Object> revoked = post(
                        "/v1/admin/student-verifications/" + id + "/revoke", admin().accessToken(), Map.of("reason", "Shared card"))
                .getBody();
        assertThat(revoked).containsEntry("state", "REJECTED").doesNotContainKey("validUntil");
        assertThat(audited(creator.id(), "student.verification_revoked")).isEqualTo(1);

        assertThat(post("/v1/admin/student-verifications/" + UUID.randomUUID() + "/approve", admin().accessToken(), Map.of())
                        .getBody())
                .containsEntry("code", "STUDENT_VERIFICATION_NOT_FOUND");
    }

    @Test
    @DisplayName("opening a photograph is staff's only, audited, an attachment, and gone once decided")
    void openingAPhotographIsAuditedAndStaffOnly() {
        Account creator = account();
        submit(creator, "BDU", "OPEN-1", JPEG, PNG);
        UUID id = idOf(creator);
        String path = "/v1/admin/student-verifications/" + id + "/documents/SELFIE";

        // The creator is not staff, about their own photograph as much as anybody's.
        ResponseEntity<byte[]> refused = bytes(path, creator.accessToken());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(audited(creator.id(), "student.document_read")).isZero();
        assertThat(get("/v1/admin/student-verifications", creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        ResponseEntity<byte[]> opened = bytes(path, admin().accessToken());
        assertThat(opened.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(opened.getBody()).isEqualTo(PNG);
        assertThat(opened.getHeaders().getContentType()).isEqualTo(MediaType.IMAGE_PNG);
        assertThat(opened.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION)).startsWith("attachment");
        assertThat(opened.getHeaders().getCacheControl()).contains("no-store");
        assertThat(audited(creator.id(), "student.document_read")).isEqualTo(1);

        post("/v1/admin/student-verifications/" + id + "/approve", admin().accessToken(), Map.of());
        assertThat(bytes(path, admin().accessToken()).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("the archive lists approved, refused and expired checks by their state now")
    void theArchiveListsByState() {
        Account current = account();
        Account lapsed = account();
        insertRow(current.id(), "ARCHIVE1", "APPROVED", Instant.now().plus(Duration.ofDays(10)));
        insertRow(lapsed.id(), "ARCHIVE2", "APPROVED", Instant.now().minus(Duration.ofDays(1)));

        assertThat(accountsIn("APPROVED")).contains(current.id().toString()).doesNotContain(lapsed.id().toString());
        assertThat(accountsIn("EXPIRED")).contains(lapsed.id().toString()).doesNotContain(current.id().toString());
    }

    // ------------------------------------------------------------------
    // Retention and erasure
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the sweep erases photographs nobody decided on, and retires approvals past their year")
    void theSweepIsTheBackstop() {
        Account creator = account();
        Account lapsed = account();
        submit(creator, "BDU", "SWEEP-1", JPEG, JPEG);
        insertRow(lapsed.id(), "SWEEP2", "APPROVED", Instant.now().minus(Duration.ofDays(1)));

        assertThat(retention.sweep(Instant.now())).isZero();
        assertThat(documentsOf(creator)).isEqualTo(2);

        assertThat(retention.sweep(Instant.now().plus(Duration.ofDays(61)))).isEqualTo(2);
        assertThat(documentsOf(creator)).isZero();
        assertThat(jdbc().queryForObject(
                        "SELECT state FROM student_verifications WHERE account_id = ?", String.class, lapsed.id()))
                .isEqualTo("EXPIRED");
    }

    @Test
    @DisplayName("anonymising an account deletes its student verifications and photographs, and nobody else's")
    void anonymisationErasesThem() {
        Account closing = account();
        Account bystander = account();
        submit(closing, "BDU", "GONE-1", JPEG, JPEG);
        submit(bystander, "BDU", "KEPT-1", JPEG, JPEG);

        deletions.request(closing.id(), PASSWORD);
        assertThat(anonymiser.anonymise(closing.id(), Instant.now().plus(Duration.ofDays(31)))).isTrue();

        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM student_verifications WHERE account_id = ?", Long.class, closing.id()))
                .isZero();
        assertThat(jdbc().queryForObject("SELECT count(*) FROM student_verification_documents d "
                                + "WHERE NOT EXISTS (SELECT 1 FROM student_verifications v WHERE v.id = d.verification_id)",
                        Long.class))
                .isZero();
        assertThat(documentsOf(bystander)).isEqualTo(2);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private List<String> accountsIn(String state) {
        return rows(get("/v1/admin/student-verifications?state=" + state, admin().accessToken())).stream()
                .map(row -> (String) row.get("accountId"))
                .toList();
    }

    private void insertRow(UUID accountId, String card, String state, Instant validUntil) {
        jdbc().update(
                """
                INSERT INTO student_verifications
                    (id, account_id, institution, card_number, state, submitted_at, decided_at, valid_until,
                     rejection_reason)
                VALUES (?, ?, 'Test University', ?, ?, now(), ?, ?, ?)
                """,
                UUID.randomUUID(),
                accountId,
                card,
                state,
                "PENDING".equals(state) ? null : Timestamp.from(Instant.now().minus(Duration.ofDays(400))),
                validUntil == null ? null : Timestamp.from(validUntil),
                "REJECTED".equals(state) ? "Refused" : null);
    }

    private UUID idOf(Account creator) {
        return jdbc().queryForObject(
                "SELECT id FROM student_verifications WHERE account_id = ? ORDER BY submitted_at DESC LIMIT 1",
                UUID.class,
                creator.id());
    }

    private long documentsOf(Account creator) {
        return jdbc().queryForObject(
                """
                SELECT count(*) FROM student_verification_documents d
                  JOIN student_verifications v ON v.id = d.verification_id
                 WHERE v.account_id = ?
                """,
                Long.class,
                creator.id());
    }

    private long audited(UUID accountId, String action) {
        return jdbc().queryForObject(
                "SELECT count(*) FROM audit_logs WHERE action = ? AND entity_id = ?", Long.class, action, accountId);
    }

    private ResponseEntity<Map<String, Object>> submit(
            Account creator, String institution, String cardNumber, byte[] studentCard, byte[] selfie) {
        MultiValueMap<String, Object> parts = new LinkedMultiValueMap<>();
        parts.add("institution", institution);
        parts.add("cardNumber", cardNumber);
        if (studentCard != null) {
            parts.add("studentCard", file(studentCard, "card.bin"));
        }
        if (selfie != null) {
            parts.add("selfie", file(selfie, "selfie.bin"));
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        headers.setBearerAuth(creator.accessToken());
        return rest.exchange(
                "/v1/me/student-verification", HttpMethod.POST, new HttpEntity<>(parts, headers), mapType());
    }

    private static ByteArrayResource file(byte[] content, String name) {
        return new ByteArrayResource(content) {
            @Override
            public String getFilename() {
                return name;
            }
        };
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(ResponseEntity<Map<String, Object>> response) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return (List<Map<String, Object>>) response.getBody().get("verifications");
    }

    private record Account(String accessToken, UUID id) {
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("student-verify-" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Student"),
                String.class);
        return issued(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    private Account admin() {
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        return issued(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    private Account issued(UUID id) {
        String accessToken = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return new Account(accessToken, id);
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(authorised(accessToken)), mapType());
    }

    private ResponseEntity<byte[]> bytes(String path, String accessToken) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(authorised(accessToken)), byte[].class);
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, authorised(accessToken)), mapType());
    }

    private static HttpHeaders authorised(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private static ParameterizedTypeReference<Map<String, Object>> mapType() {
        return new ParameterizedTypeReference<>() {};
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
