package az.ideanest.legal.infrastructure;

import az.ideanest.legal.domain.DocumentKind;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** The version of each legal document an administrator chose to show, from V96. */
@Repository
public class LegalDocumentSelections {

    private final NamedParameterJdbcTemplate jdbc;

    public LegalDocumentSelections(DataSource dataSource) {
        this.jdbc = new NamedParameterJdbcTemplate(dataSource);
    }

    /** The chosen version of this kind, or empty when the latest effective one governs. */
    public Optional<Integer> selectedVersion(DocumentKind kind) {
        return jdbc
                .query(
                        """
                        SELECT d.version
                          FROM legal_document_selections s
                          JOIN legal_documents d ON d.id = s.document_id
                         WHERE s.kind = :kind
                        """,
                        Map.of("kind", kind.name()),
                        (row, index) -> row.getInt("version"))
                .stream()
                .findFirst();
    }

    public void select(DocumentKind kind, UUID governingDocumentId, UUID staffId, Instant now) {
        jdbc.update(
                """
                INSERT INTO legal_document_selections (kind, document_id, selected_by, selected_at)
                VALUES (:kind, :document, :staff, :now)
                ON CONFLICT (kind) DO UPDATE
                   SET document_id = EXCLUDED.document_id,
                       selected_by = EXCLUDED.selected_by,
                       selected_at = EXCLUDED.selected_at
                """,
                Map.of(
                        "kind", kind.name(),
                        "document", governingDocumentId,
                        "staff", staffId,
                        "now", Timestamp.from(now)));
    }

    public void clear(DocumentKind kind) {
        jdbc.update("DELETE FROM legal_document_selections WHERE kind = :kind", Map.of("kind", kind.name()));
    }
}
