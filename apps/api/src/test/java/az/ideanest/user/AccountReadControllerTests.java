package az.ideanest.user;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import az.ideanest.shared.EmailAddress;
import az.ideanest.user.api.MeController;
import az.ideanest.user.api.OwnProfileController;
import az.ideanest.user.application.AccountSecurity;
import az.ideanest.user.application.OwnProfile;
import az.ideanest.user.application.ProfileEditing;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import az.ideanest.user.domain.ProfileVisibility;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * The two facts about an account that its owner's screens used to guess (#270), at the
 * controllers and without a database.
 *
 * <p>{@code TwoFactorApiTests} and {@code ProfileEditorApiTests} assert the same fields
 * through the real security chain and real rows. These pin the wire names and both values of
 * each, which is what the clients switch on: a renamed key or a value that is always the
 * same would put both clients back to guessing, with nothing failing to say so.
 */
class AccountReadControllerTests {

    private static final UUID ACCOUNT = UUID.randomUUID();

    private final UserAccounts users = mock(UserAccounts.class);

    private final AccountSecurity security = mock(AccountSecurity.class);

    private final ProfileEditing profiles = mock(ProfileEditing.class);

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new MeController(users, security), new OwnProfileController(profiles))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .build();

        Jwt token = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject(ACCOUNT.toString())
                .build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(token));
    }

    @AfterEach
    void clearTheSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @ParameterizedTest(name = "twoFactorEnabled is {0} when the account says so")
    @ValueSource(booleans = {true, false})
    @DisplayName("GET /v1/me says whether two-factor is on")
    void meCarriesTwoFactorStatus(boolean enabled) throws Exception {
        when(users.findById(ACCOUNT)).thenReturn(Optional.of(account()));
        when(security.twoFactorEnabled(ACCOUNT)).thenReturn(enabled);

        mvc.perform(get("/v1/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(ACCOUNT.toString()))
                .andExpect(jsonPath("$.twoFactorEnabled").value(enabled));
    }

    @ParameterizedTest(name = "profileVisibility is {0}")
    @EnumSource(ProfileVisibility.class)
    @DisplayName("GET /v1/me/profile says whether the profile page is shown")
    void ownProfileCarriesVisibility(ProfileVisibility visibility) throws Exception {
        when(profiles.forOwner(ACCOUNT)).thenReturn(profile(visibility));

        mvc.perform(get("/v1/me/profile"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("aysel"))
                .andExpect(jsonPath("$.profileVisibility").value(visibility.name()));
    }

    private static UserAccount account() {
        return new UserAccount(
                ACCOUNT,
                EmailAddress.of("aysel@example.com"),
                "Aysel",
                "aysel",
                true,
                null,
                null,
                "az",
                "AZN");
    }

    private static OwnProfile profile(ProfileVisibility visibility) {
        return new OwnProfile("Aysel", "aysel", null, null, null, null, List.of(), visibility);
    }
}
