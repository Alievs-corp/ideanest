package az.ideanest.support;

import az.ideanest.legal.application.LegalDocumentInForceChanged;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.context.event.EventListener;

/**
 * Every change to which legal version readers are shown, from whichever thread raised it.
 *
 * <p>{@code @RecordApplicationEvents} only sees events raised on the test's own thread, and a
 * publication arrives through the embedded server on one of its workers.
 */
public class RecordingLegalChanges {

    private final List<LegalDocumentInForceChanged> changes = new CopyOnWriteArrayList<>();

    @EventListener
    void on(LegalDocumentInForceChanged change) {
        changes.add(change);
    }

    public List<LegalDocumentInForceChanged> changes() {
        return List.copyOf(changes);
    }

    public void clear() {
        changes.clear();
    }
}
