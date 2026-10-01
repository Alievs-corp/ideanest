import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiOrigin } from '../api/config';
import { currentAccessToken } from './session';

/**
 * Push notifications, the phone's half — §4.12 MB-01, §12.2.
 *
 * <h2>The permission is asked for at the moment it means something</h2>
 *
 * <p>Not on launch. A permission sheet shown before somebody has seen a campaign is a
 * sheet they decline, and on iOS a declined permission cannot be asked for again from
 * inside the application — the only way back is Settings, which almost nobody walks.
 * {@link registerForPush} is therefore called from the screens where a notification has
 * an obvious purpose, and never from the root layout.
 *
 * <h2>A registration is worth nothing without a session</h2>
 *
 * The service registers a token against the account making the call, so a registration
 * attempted while signed out has nobody to belong to. This refuses rather than storing it
 * for later, because "later" is a queue of one entry that has to be flushed at sign-in and
 * cleared at sign-out, and getting the clearing wrong is how somebody's notifications
 * arrive on a phone they signed out of.
 */

/** What went wrong, when something did. Never a token — that is an address. */
export type PushRegistration =
  | { readonly status: 'registered' }
  | { readonly status: 'denied' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'failed'; readonly detail: string };

/**
 * How a notification behaves while the application is open.
 *
 * <p>Shown, with sound, and never as a badge. A badge count is a number the platform
 * expects somebody to clear, and nothing in this application clears it — a badge that
 * only ever grows is worse than none.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Registers this phone for the account that has just signed in — but only where the owner has
 * ALREADY allowed notifications, so signing in never puts a permission prompt on screen (#160
 * owns asking). A phone that has not decided, or said no, is left alone and answers `denied`.
 *
 * <p>Needed on every sign-in rather than once: sign-out drops the registration (`signOut`), and
 * a token belongs to whoever signed in most recently.
 */
export async function registerIfAllowed(): Promise<PushRegistration> {
  if (!Device.isDevice) return { status: 'unsupported' };
  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) return { status: 'denied' };
  return await registerForPush();
}

/**
 * Asks for permission, gets a token, and tells the service about it.
 *
 * <p>Called on every cold start once somebody is signed in, not only the first: the
 * service rewrites `last_seen_at` on each call, which is what its retention sweep reads,
 * and a token can be reissued by the platform at any time.
 */
export async function registerForPush(): Promise<PushRegistration> {
  /*
   * A simulator has no push service behind it. Expo answers with an error rather than a
   * token, and the error reads like a configuration problem -- so it is checked first,
   * where the answer can say what is actually true.
   */
  if (!Device.isDevice) {
    return { status: 'unsupported' };
  }

  if (currentAccessToken() === null) {
    return { status: 'signed-out' };
  }

  const existing = await Notifications.getPermissionsAsync();
  /*
   * Asked for only when it has not been decided. `requestPermissionsAsync` on a phone
   * that has already declined resolves immediately with the same answer on iOS and
   * re-prompts on some Android versions, and re-prompting somebody who said no is how an
   * application gets turned off at the system level.
   */
  const granted =
    existing.granted ||
    existing.status === 'undetermined'
      ? (await Notifications.requestPermissionsAsync()).granted
      : false;

  if (!granted) {
    return { status: 'denied' };
  }

  /*
   * Android needs a channel before anything is delivered, and one created after the first
   * notification arrives does not apply to it. `default` is the name the platform looks
   * for when a payload names none.
   */
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'IdeyaNest',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = easProjectId();
  if (projectId === null) {
    // Expo's push service issues tokens per project. Without the identifier it cannot,
    // and the failure is a build configuration problem rather than anything the person
    // holding the phone can act on.
    return { status: 'failed', detail: 'This build has no EAS project id.' };
  }

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (failure) {
    return { status: 'failed', detail: describe(failure) };
  }

  return await tellTheService('POST', token);
}

/**
 * Forgets this installation — called at sign-out, before the token is discarded.
 *
 * <p>Failure is swallowed. Sign-out must complete whatever the network is doing, and a
 * registration that outlives it is caught on the service's side the next time a send is
 * refused, or by its retention sweep. Blocking somebody's sign-out on a push cleanup
 * would be the wrong trade.
 */
export async function unregisterFromPush(): Promise<void> {
  const projectId = easProjectId();
  if (projectId === null) return;

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await tellTheService('DELETE', token);
  } catch {
    // Deliberately silent. See above.
  }
}

/**
 * The one call this module makes.
 *
 * <p>Written with `fetch` rather than through `@ideanest/api-client`, because that client
 * is reads only — by design, see its own note on why a write that made it easy to skip
 * `Idempotency-Key` would be the wrong shape. Registration needs no such key: the same
 * token twice is the same upsert.
 */
async function tellTheService(method: 'POST' | 'DELETE', token: string): Promise<PushRegistration> {
  const accessToken = currentAccessToken();
  if (accessToken === null) {
    return { status: 'signed-out' };
  }

  try {
    const response = await fetch(`${apiOrigin()}/v1/me/devices`, {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
        deviceName: Device.deviceName ?? undefined,
        appVersion: Constants.expoConfig?.version ?? undefined,
      }),
    });

    if (!response.ok) {
      // The status and nothing else. A problem detail about a token is a document that
      // names an address, and this string ends up in a log.
      return { status: 'failed', detail: `The service answered ${response.status}.` };
    }
    return { status: 'registered' };
  } catch (failure) {
    return { status: 'failed', detail: describe(failure) };
  }
}

/**
 * The EAS project this build belongs to.
 *
 * <p>Two places, because Expo has moved it: `extra.eas.projectId` is where `eas init`
 * writes it and `easConfig.projectId` is where the runtime surfaces it. Reading both is
 * what stops a token request failing on one SDK and working on another.
 */
function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
    ?.projectId;
  const fromConfig = Constants.easConfig?.projectId;
  return fromExtra ?? fromConfig ?? null;
}

/** An error as one short line, with nothing from the payload in it. */
function describe(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'The request could not be made.';
}
