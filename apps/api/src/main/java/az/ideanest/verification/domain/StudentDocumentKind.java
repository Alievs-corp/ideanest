package az.ideanest.verification.domain;

import java.util.Set;

/**
 * The two photographs a student verification carries — #655. Both are required.
 */
public enum StudentDocumentKind {

    /** The student card. A photograph or a scan: JPEG, PNG or PDF. */
    STUDENT_CARD(Set.of("image/jpeg", "image/png", "application/pdf")),

    /**
     * The creator's face, so the reviewer can compare it with the card's photograph. A
     * photograph only: a PDF of somebody's face is a document nobody should have to open in a
     * PDF viewer, and V127's check refuses one too.
     */
    SELFIE(Set.of("image/jpeg", "image/png"));

    private final Set<String> accepts;

    StudentDocumentKind(Set<String> accepts) {
        this.accepts = accepts;
    }

    /** Whether a file of this media type — decided from its bytes — may be this kind. */
    public boolean accepts(String mediaType) {
        return accepts.contains(mediaType);
    }
}
