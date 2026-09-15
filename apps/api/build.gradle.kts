plugins {
    java
    id("org.springframework.boot") version "4.1.1"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "az.ideanest"
version = "0.0.1-SNAPSHOT"
description = "IdeaNest API"

java {
    // A toolchain, not `sourceCompatibility`: the build then produces the same
    // bytecode on a developer machine running any JDK as it does in CI.
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")

    // §18's metrics -- issue #138. Micrometer is already on the path through the
    // actuator; this is the registry that renders it in the format a scraper reads.
    // Prometheus and not a hosted vendor's SDK: the exposition format is text over
    // HTTP with no agent, no queue and no credential in the application, so a
    // deployment that changes where metrics go changes a scrape config rather than
    // this build file.
    implementation("io.micrometer:micrometer-registry-prometheus")

    // `RestClient.Builder`, which #127's cache invalidator injects.
    //
    // EXPLICIT BECAUSE THE TESTS CANNOT CATCH ITS ABSENCE. Spring Boot 4 split
    // autoconfiguration into per-technology modules and `spring-boot-starter-web`
    // does not bring this one; `spring-boot-starter-test` does, transitively,
    // through `spring-boot-resttestclient`. So the whole integration suite loaded
    // the context happily and the built jar refused to start:
    //
    //   Parameter 1 of constructor in CacheInvalidator required a bean of type
    //   'org.springframework.web.client.RestClient$Builder' that could not be found.
    //
    // Found by running the image rather than by reading the build file, which is
    // the only place it was ever going to show up.
    implementation("org.springframework.boot:spring-boot-restclient")

    // §18's tracing. The bridge turns Micrometer's observations into OpenTelemetry
    // spans and the exporter ships them; both are inert until a collector endpoint
    // is configured, which is why they cost a deployment nothing to have.
    //
    // OpenTelemetry rather than Brave: `CorrelationFilter` already accepts and mints
    // W3C `traceparent`, which is OTel's native propagation format, and a service
    // that spoke B3 on the wire and W3C in its logs would correlate with neither.
    implementation("io.micrometer:micrometer-tracing-bridge-otel")
    implementation("io.opentelemetry:opentelemetry-exporter-otlp")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-security")
    // Validates the access token on every request, and signs it. Nimbus
    // underneath, which is the reference JOSE implementation for the JVM.
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")

    // Argon2id. Spring Security's Argon2PasswordEncoder delegates to
    // BouncyCastle, which is pure Java — unlike argon2-jvm, which binds a
    // native library through JNA and turns "does the container have libargon2"
    // into a start-up question.
    implementation("org.bouncycastle:bcprov-jdk18on:1.86")

    // The starter rather than flyway-core alone. Spring Boot 4 broke
    // spring-boot-autoconfigure into per-technology modules, so Flyway's
    // auto-configuration now ships in spring-boot-flyway; with only flyway-core on
    // the path nothing runs the migrations and Hibernate validates against an
    // empty schema.
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    // Flyway 10 split its database support out of the core artifact. Without
    // this the service starts and then fails on the first migration with a
    // message about an unsupported database.
    implementation("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("org.postgresql:postgresql")

    // The OpenAPI 3.1 document §10.1 says the public API is described by, built
    // from the controllers rather than written beside them (#136). The `-api`
    // starter and not `-ui`: this service publishes a contract, and Swagger UI is
    // a web application with its own asset pipeline that nothing here needs — the
    // browsable version belongs wherever the documentation is hosted, not in the
    // deployed jar. 3.x is the line that supports Spring Boot 4; 2.x targets
    // Spring Framework 6 and does not start here.
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-api:3.1.1")

    // #86: the transport behind NotificationChannel.EMAIL. JavaMailSender and
    // its auto-configuration, which in Spring Boot 4 is its own module rather
    // than part of spring-boot-autoconfigure — the same split flyway needed
    // above.
    implementation("org.springframework.boot:spring-boot-starter-mail")
    // #86's templates. The engine on its own, and deliberately neither of the
    // two obvious alternatives.
    //
    // Not spring-boot-starter-thymeleaf: it additionally registers a
    // ViewResolver and a template resolver for rendering HTTP responses. This
    // service answers in JSON and server-renders nothing, so that would be a
    // web-facing surface added for the sake of a mail body.
    //
    // Not thymeleaf-spring6 either, which is what §16 names — it integrates the
    // engine with Spring 6, and spring-boot-mail brings Spring Framework 7.
    // Nothing in an email template needs that integration: the templates are
    // rendered from a Map, and the subject lines come from MessageSource in
    // Java rather than through a th:text lookup. So the coupling buys nothing
    // and costs a version constraint. §16 is updated to say this.
    implementation("org.thymeleaf:thymeleaf")

    // #91: §12.1's live counters and comments. The starter brings Spring's
    // WebSocket support and Tomcat's implementation of the protocol.
    //
    // The plain handler API and not STOMP, which the starter also enables and
    // which nothing here registers. STOMP is a messaging protocol with
    // destinations, subscriptions, acknowledgements and a broker relay; what
    // §12.1 describes is a page that receives a counter, and adding a frame
    // format on top of it would mean a client library on the other side — on the
    // route with the tightest First Load JS budget on the platform.
    //
    // §16 names a Redis relay beside this for scaling across replicas. That is
    // deliberately not here: no Redis is deployed, and `RealtimeBroadcaster`
    // states what the single-node bound costs rather than implying it is absent.
    implementation("org.springframework.boot:spring-boot-starter-websocket")

    // UUID v7: time-ordered, so primary keys are generated in the application
    // without giving up index locality the way v4 does. Java has no built-in.
    implementation("com.github.f4b6a3:uuid-creator:6.1.1")

    // §13.1's object storage -- the media pipeline design of 2026-08-30.
    //
    // The S3 protocol rather than one vendor's own: R2, MinIO and S3 itself all speak
    // it, and which of them a deployment uses is not this repository's decision to
    // make -- `deploy.yml` rolls out a digest through a hook and owns no
    // infrastructure to decide on.
    //
    // Two artefacts and not the whole SDK. `s3` is the client; the presigner ships
    // inside it and is what issues the address a browser uploads to directly, so that
    // twenty megabytes never occupies a request thread here. `apache5-client` is named
    // explicitly because the SDK otherwise picks an HTTP implementation off the
    // classpath at run time -- a start-up failure in the built jar that no test sees,
    // which is exactly the way `spring-boot-restclient` was found to be missing above.
    //
    // APACHE 5 AND NOT APACHE 4 SINCE 2.54 -- issue #396. `s3` now depends on
    // `apache5-client` itself, so keeping the old `apache-client` beside it put two
    // implementations on the classpath and the SDK refuses to guess between them:
    // "Multiple HTTP implementations were found on the classpath". One is named here,
    // and `S3ObjectStore` additionally passes it to the builder, so neither this file
    // nor a future transitive dependency decides the transport by accident.
    implementation(platform("software.amazon.awssdk:bom:2.54.16"))
    implementation("software.amazon.awssdk:s3")
    implementation("software.amazon.awssdk:apache5-client")

    // `bootRun` starts and stops the local compose stack. Development only, so
    // it never reaches the deployed jar.
    developmentOnly("org.springframework.boot:spring-boot-docker-compose")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    // Spring Boot 4 moved TestRestTemplate out of spring-boot-test into its own
    // module, and it needs RestTemplateBuilder from spring-boot-restclient to be
    // built. Neither arrives with the starter any more, so both are named here.
    testImplementation("org.springframework.boot:spring-boot-resttestclient")
    testImplementation("org.springframework.boot:spring-boot-restclient")
    // A real PostgreSQL, not an in-memory substitute. An in-memory database
    // does not reproduce PostgreSQL locking, constraints, or numeric
    // semantics -- precisely the behaviour this platform depends on.
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    // Testcontainers 2 renamed every module to carry the project's own prefix,
    // so `junit-jupiter` and `postgresql` no longer name anything. Versions still
    // come from Spring Boot's platform; only the artefact ids moved.
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    // Module boundaries that are only written down are module boundaries that
    // erode. These are the same rules as az/ideanest/package-info.java, checked.
    testImplementation("com.tngtech.archunit:archunit-junit5:1.5.0")
    // The provider stub. Google and Apple are not called from a test — a suite
    // that depends on somebody else's uptime fails for reasons that are not
    // ours, and neither of them will sign a token for a key we control. The
    // standalone artefact shades its own Jetty and Jackson, so the stub cannot
    // drag the application's versions around underneath it.
    testImplementation("org.wiremock:wiremock-standalone:3.13.2")
    // #86's SMTP server, for the same reason Testcontainers runs a real
    // PostgreSQL: a mocked JavaMailSender proves the code called it, not that
    // what came out was a message a mail client can read. GreenMail runs
    // in-process on a free port and hands back the received MIME, so the
    // subject, the two body parts and the Message-ID are asserted as they went
    // over the wire.
    testImplementation("com.icegreen:greenmail-junit5:2.1.13")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    // A warning nobody is forced to read is a warning nobody reads. `serial` is
    // off because we do not rely on serialisation compatibility, and
    // `processing` because Spring's configuration processor is not always on
    // the path.
    options.compilerArgs.addAll(listOf("-Xlint:all,-serial,-processing", "-Werror"))
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

// #136: rewrite openapi.json from the running application.
//
// A task rather than something `build` does, and that is the point. The contract
// is a reviewed file: a build that regenerated it would make every change to a
// response body invisible in review, which is the same failure as accepting a
// visual snapshot without reading what changed. `check` asserts that the file is
// current; this is how you make it current, deliberately, and then read the diff.
//
// It reuses the ordinary test task's classpath and the ordinary integration test
// container, because the only honest source of the document is the application
// with every controller wired up. `outputs.upToDateWhen { false }` because the
// point of running it is to overwrite a file whose contents Gradle cannot predict.
tasks.register<Test>("exportOpenApi") {
    group = "documentation"
    description = "Regenerates apps/api/openapi.json from the running application."

    testClassesDirs = sourceSets["test"].output.classesDirs
    classpath = sourceSets["test"].runtimeClasspath
    useJUnitPlatform()
    filter { includeTestsMatching("az.ideanest.OpenApiContractTests") }
    systemProperty("openapi.write", "true")
    outputs.upToDateWhen { false }
}
