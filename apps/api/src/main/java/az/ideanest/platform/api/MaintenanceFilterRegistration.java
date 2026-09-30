package az.ideanest.platform.api;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Keeps {@link MaintenanceFilter} out of the servlet container's own filter list — #214.
 *
 * <p>Spring Boot registers every {@code Filter} bean with the container by default, which
 * would run this one ahead of Spring Security, where no request is authenticated yet and
 * every staff token would look like nobody's. It runs where {@code SecurityConfiguration}
 * puts it, inside the security chain, and only there.
 */
@Configuration(proxyBeanMethods = false)
public class MaintenanceFilterRegistration {

    @Bean
    public FilterRegistrationBean<MaintenanceFilter> maintenanceFilterOutsideTheContainer(MaintenanceFilter filter) {
        FilterRegistrationBean<MaintenanceFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
}
