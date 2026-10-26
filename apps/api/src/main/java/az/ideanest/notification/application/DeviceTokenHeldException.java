package az.ideanest.notification.application;

/**
 * A push token another account has registered and is still signed in to hold — #587.
 *
 * <p>Like {@link UnusableDeviceTokenException} it carries neither the token nor either
 * account: the token is an address, and a problem detail is a document a client may log.
 */
public class DeviceTokenHeldException extends RuntimeException {

    public DeviceTokenHeldException() {
        super("This installation is registered to another account that is still signed in");
    }
}
