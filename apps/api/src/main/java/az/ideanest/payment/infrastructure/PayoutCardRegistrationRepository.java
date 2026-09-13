package az.ideanest.payment.infrastructure;

import az.ideanest.payment.domain.PayoutCardRegistration;
import az.ideanest.payment.domain.ProviderName;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PayoutCardRegistrationRepository extends JpaRepository<PayoutCardRegistration, UUID> {

    /** IDN-EXT-01 (#44): the registration a provider's callback is about. V81 makes it unique. */
    Optional<PayoutCardRegistration> findByProviderAndCardId(ProviderName provider, String cardId);
}
