package az.ideanest;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Entry point for the IdeyaNest API.
 *
 * <p>The service is a modular monolith. Every module lives in its own package
 * under {@code az.ideanest} and is described in that package's
 * {@code package-info.java}.
 */
@SpringBootApplication
// Typed configuration, bound and validated at start-up. A setting that is
// misspelled or missing then fails the process rather than surfacing as a null
// on the first request that reads it.
@ConfigurationPropertiesScan
public class IdeaNestApplication {

    public static void main(String[] args) {
        SpringApplication.run(IdeaNestApplication.class, args);
    }
}
