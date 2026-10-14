package az.ideanest.user.application;

/**
 * How an account is named beside something it wrote in public — #255, the comment author.
 *
 * <p>Only what a public profile already shows a stranger, and only for an account whose
 * profile is public: {@link PublicProfiles#publicNames} is the one place that decides. No
 * slug, because nothing that carries this links anywhere yet, and no identifier, because the
 * caller already holds it as the key it asked with.
 *
 * @param name the display name, as it is now
 * @param avatarUrl the picture, or null for the many accounts that have none
 */
public record PublicName(String name, String avatarUrl) {
}
