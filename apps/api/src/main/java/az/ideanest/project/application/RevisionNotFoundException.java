package az.ideanest.project.application;

import java.util.UUID;

/** No such revision, or none open on the campaign the caller named. Answered as 404 {@code REVISION_NOT_FOUND}. */
public class RevisionNotFoundException extends RuntimeException {

    public RevisionNotFoundException(UUID id) {
        super("No revision " + id);
    }
}
