package az.ideanest.auth.application;

/**
 * An address change that cannot be confirmed because the address has acquired an
 * account since the change was asked for.
 *
 * <p><strong>Only the confirmation raises this.</strong> Asking for a change to an
 * address that already has an account used to be refused with it too, and that made
 * {@code POST /v1/auth/change-email} a "does this address have an account here?" oracle
 * for anybody signed in with a list of addresses to try. Since #587 that request is
 * answered with the same 202 as any other and the address's owner is told instead —
 * see {@code AccountCredentialsService#requestEmailChange}.
 *
 * <p>At confirmation the caller holds a link that was sent to that very address, so
 * saying the address was taken in the meantime tells them nothing they could not have
 * learnt by reading their own mail, and it is the only way they can act on it.
 */
public class EmailAlreadyInUseException extends RuntimeException {

    public EmailAlreadyInUseException(String message) {
        super(message);
    }
}
