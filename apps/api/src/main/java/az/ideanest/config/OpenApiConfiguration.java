package az.ideanest.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The published API contract — §10.1's "REST with OpenAPI 3.1", and #136.
 *
 * <p><strong>Generated from the controllers, not written beside them.</strong> A
 * specification maintained by hand is a specification that describes what somebody
 * intended in the release they last edited it; this one cannot disagree with the service
 * because it is derived from the same mappings the service dispatches on. What is written
 * here is only what a scanner cannot infer: who publishes the API, where it lives, and how
 * a caller proves who they are.
 *
 * <p><strong>It is a build artefact and a reviewed file at the same time.</strong>
 * {@code OpenApiContractTests} exports the document to {@code apps/api/openapi.json} and
 * fails when the committed copy is out of date, so a change to a response body shows up in
 * a diff rather than in a client's runtime. That is the whole point of #136: the web and
 * mobile clients are generated from this file, so a field renamed without noticing becomes
 * a compile error in {@code @ideanest/api-client} rather than an {@code undefined} on
 * somebody's screen.
 *
 * <h2>Why the {@code -api} starter and no Swagger UI</h2>
 *
 * <p>Swagger UI is a web application with its own assets, its own CSP requirements, and its
 * own history of vulnerabilities, deployed inside the service that holds the payment
 * endpoints. What #136 asks for is a specification that produces typed clients, and that is
 * a JSON document. A browsable rendering belongs wherever the documentation is hosted, built
 * from the same committed file.
 *
 * <h2>The security scheme, and what it does and does not say</h2>
 *
 * <p>One scheme — §10.3's {@code Authorization: Bearer} — declared once and required
 * globally, because the overwhelming majority of the surface needs it and
 * {@code SecurityConfiguration} denies by default.
 *
 * <p><strong>The public reads are the exception, and the document does not mark them.</strong>
 * §10.2 lists them and {@code SecurityConfiguration} is where the rule actually lives;
 * teaching this file to enumerate them would be a second copy of that list, and the copy
 * that falls behind would tell a client that an endpoint needs a token it does not, or —
 * worse — that one does not need a token it does. A generated client sends the token when
 * it has one, which is correct for every endpoint here: the public reads accept an
 * anonymous caller and also accept a signed-in one, and several of them answer differently
 * because of it.
 */
@Configuration(proxyBeanMethods = false)
public class OpenApiConfiguration {

    /** §10.3: the version is in the URL prefix, so it is the version of the contract. */
    private static final String API_VERSION = "1";

    /** The name the requirement below and every generated client refer to the scheme by. */
    private static final String BEARER_SCHEME = "bearerAuth";

    @Bean
    public OpenAPI ideaNestApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("IdeyaNest API")
                        .version(API_VERSION)
                        .description(
                                """
                                The public API of the IdeyaNest crowdfunding platform, as \
                                specified in docs/architecture.md §10.

                                Two conventions are worth reading before generating a client \
                                against this document. **Money is an object with a string \
                                amount** — `{"amount": "599.00", "currency": "AZN"}` — and \
                                never a JSON number, because a JSON number is an IEEE 754 \
                                double and cannot hold what somebody pledged. **Errors are \
                                RFC 9457 problem details** carrying a `code` alongside the \
                                status; the status says how to behave and the code says what \
                                happened, and a client branches on the code.

                                Endpoints listed under "Project — public", discovery, and \
                                search answer without an `Authorization` header. Everything \
                                else refuses one that is absent.""")
                        .license(new License().name("Proprietary")))
                // Relative, deliberately. The web application proxies /v1 under its own
                // origin — next.config.mjs explains why the refresh cookie makes that the
                // only arrangement that works — so a generated client that hard-coded an
                // absolute API host would send the browser cross-origin and lose the cookie.
                .servers(List.of(new Server().url("/").description("This deployment")))
                .components(new Components()
                        .addSecuritySchemes(
                                BEARER_SCHEME,
                                new SecurityScheme()
                                        .type(SecurityScheme.Type.HTTP)
                                        .scheme("bearer")
                                        .bearerFormat("JWT")
                                        .description(
                                                "A fifteen-minute access token from POST /v1/auth/login or"
                                                        + " /v1/auth/refresh. The refresh token is not sent this"
                                                        + " way: it lives in an httpOnly cookie on web and in"
                                                        + " secure storage on mobile.")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER_SCHEME));
    }

    /**
     * A stable, readable name for every operation.
     *
     * <p><strong>springdoc's default is the handler method's name, and it collides.</strong>
     * Fifty-two controllers share a small vocabulary — {@code page}, {@code list},
     * {@code create} — and the second one to be scanned is renamed {@code page_1}. That is
     * bad in a published contract and worse in a generated client: the suffix is decided by
     * classpath scan order, so a method somebody adds to an unrelated controller can rename
     * an existing operation and break a client that never changed.
     *
     * <p>Qualifying by the controller instead makes the name a property of where the
     * operation is defined. {@code PublicProjectController.page} is {@code publicProjectPage}
     * whatever else exists, and it stays that way until somebody deliberately moves or
     * renames the handler — which is the point at which a client ought to be told.
     *
     * <p>Not derived from the path, which was the alternative: {@code /v1/projects/{id}}
     * carries a {@code GET}, a {@code PATCH} and three sub-resources, and a name built from
     * the URL either loses the method or becomes {@code getV1ProjectsId}. A method name is
     * what the team already calls the operation.
     */
    @Bean
    public OperationCustomizer operationIds() {
        return (operation, handlerMethod) -> {
            String controller =
                    handlerMethod.getBeanType().getSimpleName().replaceAll("Controller$", "");
            operation.setOperationId(
                    uncapitalise(controller) + capitalise(handlerMethod.getMethod().getName()));
            return operation;
        };
    }

    private static String capitalise(String value) {
        return value.isEmpty() ? value : Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    private static String uncapitalise(String value) {
        return value.isEmpty() ? value : Character.toLowerCase(value.charAt(0)) + value.substring(1);
    }
}
