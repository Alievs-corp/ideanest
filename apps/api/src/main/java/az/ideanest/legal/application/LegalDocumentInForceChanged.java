package az.ideanest.legal.application;

import az.ideanest.legal.domain.DocumentKind;

/** The version of a legal document readers are shown changed: one was published or made active. */
public record LegalDocumentInForceChanged(DocumentKind kind, int version) {
}
