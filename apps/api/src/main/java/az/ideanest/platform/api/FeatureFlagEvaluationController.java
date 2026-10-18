package az.ideanest.platform.api;

import az.ideanest.platform.PlatformProperties;
import az.ideanest.platform.application.FeatureFlags;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * What is switched on for the caller — AD-12's other half.
 *
 * <p>{@code FeatureFlags.evaluateAll} existed and nothing could ask it: the console edited
 * flags that no client was able to read, so a switch on the screen switched nothing. This
 * is where a client reads them, once per page, through {@code apps/web}'s
 * {@code lib/feature-flags.ts}.
 *
 * <p><strong>Public, and personal when a token is sent.</strong> A visitor gets the answer
 * that does not depend on who is asking — a flag is on for them only when it is on for
 * everybody — and a signed-in reader gets theirs, with the accounts named on a flag and
 * their place in a partial rollout. Nothing in the answer is somebody else's: it is the
 * flags' names and a yes or no for each.
 *
 * <p><strong>Cached by the caller only.</strong> {@code private}, for as long as the
 * service's own snapshot is held, and varying on {@code Authorization}: one reader's answer
 * must never be served to another by something in between, and a copy older than the
 * service's own snapshot would make a switch slower than it has to be.
 */
@RestController
public class FeatureFlagEvaluationController {

    private final FeatureFlags flags;
    private final PlatformProperties properties;

    public FeatureFlagEvaluationController(FeatureFlags flags, PlatformProperties properties) {
        this.flags = flags;
        this.properties = properties;
    }

    @GetMapping("/v1/feature-flags")
    public ResponseEntity<PlatformResponses.FlagAnswers> evaluate(@AuthenticationPrincipal Jwt accessToken) {
        UUID caller = accessToken == null ? null : UUID.fromString(accessToken.getSubject());

        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(properties.flags().cacheTtl()).cachePrivate())
                .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
                .body(new PlatformResponses.FlagAnswers(flags.evaluateAll(caller)));
    }
}
