package az.ideanest.notification.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One edit to the copy of a platform email — V52's row, issue #315.
 *
 * <p><strong>Nothing is updated in place except {@code live}.</strong> V52's header has the
 * argument: §12.3's templates include the payment-failure notice, and "what did the notice
 * say in March" is asked when somebody claims they were never told their card had failed.
 * A table holding only the current text cannot answer it, so each edit appends a version
 * and the newest live one renders.
 *
 * <p>{@code requiredPlaceholders} is copied onto the row rather than read from the
 * catalogue at render time, so that a version stays checkable after the shipped copy has
 * moved on — which is the difference between an audit that can be re-run and one that can
 * only be believed.
 */
@Entity
@Table(name = "email_template_versions")
public class EmailTemplateVersion {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "template_key", nullable = false, updatable = false)
    private String templateKey;

    @Column(name = "locale", nullable = false, updatable = false)
    private String locale;

    @Column(name = "version", nullable = false, updatable = false)
    private int version;

    @Column(name = "subject", nullable = false, updatable = false)
    private String subject;

    @Column(name = "body", nullable = false, updatable = false)
    private String body;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "required_placeholders", nullable = false, updatable = false)
    private String[] requiredPlaceholders;

    /** The one column that moves. Withdrawing an override sends the shipped copy again. */
    @Column(name = "live", nullable = false)
    private boolean live;

    @Column(name = "note", updatable = false)
    private String note;

    /**
     * Set by the writer rather than by the column default, so that the response to the write
     * carries it — a default the database fills is not on the entity Hibernate hands back.
     */
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    protected EmailTemplateVersion() {
        // Hibernate.
    }

    public EmailTemplateVersion(
            String templateKey,
            String locale,
            int version,
            String subject,
            String body,
            List<String> requiredPlaceholders,
            String note,
            UUID createdBy,
            Instant createdAt) {

        this.id = Identifiers.newIdentifier();
        this.templateKey = Objects.requireNonNull(templateKey, "templateKey");
        this.locale = Objects.requireNonNull(locale, "locale");
        this.version = version;
        this.subject = Objects.requireNonNull(subject, "subject");
        this.body = Objects.requireNonNull(body, "body");
        this.requiredPlaceholders = requiredPlaceholders.toArray(String[]::new);
        this.live = true;
        this.note = note;
        this.createdBy = Objects.requireNonNull(createdBy, "createdBy");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    /**
     * Takes this version out of service.
     *
     * <p>Called on the previous live version when a new one is written, and on the current
     * one when an override is withdrawn entirely — after which the shipped catalogue copy
     * renders again. V52's partial unique index permits at most one live version per
     * template and locale, so the two writes are one transaction.
     */
    public void withdraw() {
        this.live = false;
    }

    public UUID id() {
        return id;
    }

    public String templateKey() {
        return templateKey;
    }

    public String locale() {
        return locale;
    }

    public int version() {
        return version;
    }

    public String subject() {
        return subject;
    }

    public String body() {
        return body;
    }

    public List<String> requiredPlaceholders() {
        return List.of(requiredPlaceholders);
    }

    public boolean live() {
        return live;
    }

    public String note() {
        return note;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public UUID createdBy() {
        return createdBy;
    }
}
