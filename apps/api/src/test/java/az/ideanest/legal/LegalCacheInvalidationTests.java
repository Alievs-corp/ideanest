package az.ideanest.legal;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import az.ideanest.legal.application.LegalCacheInvalidation;
import az.ideanest.legal.application.LegalDocumentInForceChanged;
import az.ideanest.legal.domain.DocumentKind;
import az.ideanest.shared.cache.CacheInvalidator;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class LegalCacheInvalidationTests {

    @Test
    @DisplayName("a published version drops the web's legal tag")
    void aPublicationDropsTheLegalTag() {
        CacheInvalidator invalidator = mock(CacheInvalidator.class);

        new LegalCacheInvalidation(invalidator).on(new LegalDocumentInForceChanged(DocumentKind.TERMS_OF_USE, 4));

        verify(invalidator).invalidate(List.of("legal"));
    }
}
