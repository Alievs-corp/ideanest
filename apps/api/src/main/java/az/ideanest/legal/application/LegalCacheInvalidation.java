package az.ideanest.legal.application;

import az.ideanest.shared.cache.CacheInvalidator;
import az.ideanest.shared.cache.CacheTags;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Drops the web's cached legal pages when a version is published.
 *
 * <p>The web holds legal reads for an hour under {@link CacheTags#LEGAL}. Without this, a
 * version published in the console reached the site up to an hour later. After commit, so the
 * web's next read cannot race the transaction and cache the previous version again.
 */
@Component
public class LegalCacheInvalidation {

    private final CacheInvalidator invalidator;

    public LegalCacheInvalidation(CacheInvalidator invalidator) {
        this.invalidator = invalidator;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(LegalDocumentInForceChanged event) {
        invalidator.invalidate(List.of(CacheTags.LEGAL));
    }
}
