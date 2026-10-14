package az.ideanest.user.api;

import az.ideanest.user.application.AccountSecurity;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The signed-in user's own account.
 *
 * <p>The first endpoint behind authentication, and therefore the thing that
 * proves an access token actually works end to end rather than merely parsing.
 */
@RestController
public class MeController {

    private final UserAccounts users;
    private final AccountSecurity security;

    public MeController(UserAccounts users, AccountSecurity security) {
        this.users = users;
        this.security = security;
    }

    /**
     * @param id the account
     * @param email returned in full, because the person reading it is the
     *     person it belongs to
     * @param locale which of §21.1's four languages this account is set to (#324).
     *     Carried on the owner's own read because the client cannot derive it: the
     *     preference screen has to open showing the language that is stored rather
     *     than the one the browser happens to be asking in, and every request the
     *     client makes afterwards has to carry that same language as
     *     {@code Accept-Language} — otherwise a person who chose Russian on one
     *     device reads Azerbaijani on the next, and nothing on screen explains why
     * @param deletionScheduledAt when this account will be anonymised, or absent
     *     when nobody has asked for that. The client needs it to show the state
     *     the account is actually in — an account that has been closed and can
     *     still sign in has to say so, or the user assumes the deletion failed
     *     and asks support
     * @param twoFactorEnabled whether sign-in demands a second factor (#270): a confirmed
     *     enrolment, never one that was started and abandoned. Without it the owner's security
     *     screen has to offer both "set it up" and "turn it off" and let the service's refusal
     *     say which applied
     */
    public record MeResponse(
            UUID id,
            String email,
            String name,
            String slug,
            String locale,
            /**
             * §4.2's P-10's currency half (#327): the currency this account reads amounts
             * in. The platform's own base currency for anybody who has not chosen, and a
             * display preference either way — collection happens in the campaign's currency
             * whatever this says.
             */
            String currency,
            boolean emailVerified,
            Instant deletionScheduledAt,
            boolean twoFactorEnabled) {
    }

    @GetMapping("/v1/me")
    public ResponseEntity<MeResponse> me(@AuthenticationPrincipal Jwt accessToken) {
        // The subject is the user, established by a signature we made. It is
        // not read from anything the caller could choose.
        UUID userId = UUID.fromString(accessToken.getSubject());

        return users.findById(userId)
                .map(this::toResponse)
                // A valid token for an account that no longer exists — deleted
                // between issue and use. The token is genuine and there is
                // nothing to return, which is 404 rather than 401.
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    private MeResponse toResponse(UserAccount account) {
        return new MeResponse(
                account.id(),
                account.email().value(),
                account.name(),
                account.slug(),
                account.locale(),
                account.currency(),
                account.emailVerified(),
                account.deletionScheduledAt(),
                security.twoFactorEnabled(account.id()));
    }
}
