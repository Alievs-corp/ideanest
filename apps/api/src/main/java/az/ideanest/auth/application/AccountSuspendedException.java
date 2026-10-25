package az.ideanest.auth.application;

/**
 * The password was right and the account has been stopped — §4.11's AD-04 (#104).
 *
 * <p><strong>Distinct from {@link AuthenticationFailedException}, and deliberately
 * told.</strong> Every other refusal on this path is the same sentence on purpose: which
 * half of an address-and-password pair was wrong is an oracle, and the platform declines
 * to be one. This is not that. It is raised only after the password has been verified, so
 * it tells the person nothing they did not already know about their own account — and
 * refusing them with "those details are wrong" would send them round a password reset that
 * cannot help, twice, before they write to support anyway.
 *
 * <p>The same holds for the other ways in (#576): a provider sign-in raises it only after
 * the provider's ID token has been verified, and a two-factor completion only after the
 * code has been accepted. Each of them is proof of who is asking, so each gets the same
 * answer the password does.
 *
 * <p>What it does not carry is the reason. That is prose a moderator wrote, it belongs in
 * the message the person is sent rather than in a refusal any client can log, and §4.10
 * has no notification type for it yet — which is stated in §4.11 rather than papered over
 * here.
 */
public class AccountSuspendedException extends RuntimeException {

    public AccountSuspendedException() {
        super("This account has been suspended. Contact support.");
    }
}
