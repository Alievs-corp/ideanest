/**
 * What every test in this package gets, and why each mock exists.
 *
 * `@testing-library/react-native` is not imported here. Its matchers have been
 * built into the library since v12.4 and the `extend-expect` entry point was
 * removed in v14 -- a setup file that still reaches for it fails every suite
 * with a module-not-found naming a path that reads like a typo.
 */
/**
 * MMKV is a native module. It has no JavaScript fallback by design — that is
 * the point of it — so under Jest it must be replaced rather than loaded.
 *
 * The replacement is a real `Map` and not a stub returning `undefined`, because
 * the code under test is a cache: a store that forgets everything makes an
 * offline test pass for the wrong reason. `src/lib/storage.ts` is the only
 * module that imports MMKV, so this mock has exactly one consumer.
 */
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const entries = new Map<string, string | number | boolean>();
    return {
      getString: (key: string) => {
        const value = entries.get(key);
        return typeof value === 'string' ? value : undefined;
      },
      set: (key: string, value: string | number | boolean) => void entries.set(key, value),
      remove: (key: string) => entries.delete(key),
      contains: (key: string) => entries.has(key),
      getAllKeys: () => [...entries.keys()],
      clearAll: () => entries.clear(),
    };
  },
}));

/**
 * EVERY EXPO NATIVE MODULE THIS APPLICATION IMPORTS IS MOCKED HERE, AND THE LIST
 * IS THE POINT.
 *
 * <p>Each of these reaches native code at MODULE LOAD — `requireNativeModule` or
 * `requireNativeViewManager` at the top of the file — so merely importing a
 * component that uses one throws before a single test runs. jest-expo registers
 * a mock only for modules its own registry knows about, and which ones those are
 * is environment state: this suite passed on Windows and failed on Linux with an
 * identical lockfile, identical `Platform.OS`, and the same files resolving.
 *
 * <p>Mocking them one at a time as each failure appeared cost four pushes and
 * found a fifth. They are enumerated instead — the list is exactly what
 * `grep -rhoE "from 'expo[^']*'" src` answers — so adding an Expo dependency and
 * forgetting this file fails once, here, rather than intermittently by operating
 * system.
 *
 * <p>What is NOT mocked: `react-native-reanimated` (see the note at the end),
 * `@shopify/flash-list` and `react-native-safe-area-context`, which ship working
 * JavaScript implementations and are exercised for real. Gesture handler's
 * native half is replaced by its own test setup, at the end of this file.
 */

/**
 * `expo-image`, replaced by React Native's own `Image`.
 *
 * <p>`ExpoImage.tsx` calls `requireNativeViewManager` AT MODULE LOAD, so merely
 * importing a component that renders one throws before any test runs — the same
 * shape as the router below, and the reason both are here rather than one.
 *
 * <p>Whether it throws depends on whether the native view is registered in
 * jest-expo's mock registry, which is environment state: this passed on Windows
 * and failed on Linux with identical `Platform.OS`, an identical lockfile, and
 * the same module resolving to the same `src/index.ts`. A unit test of a card
 * should not depend on that, and with this mock it does not.
 *
 * <p>An RN `Image` rather than a `View`: it takes the same `source` prop, so a
 * test can still assert what a card points its picture at.
 */
jest.mock('expo-image', () => {
  const { Image } = require('react-native');
  return { Image, useImage: () => null };
});

/**
 * The session's keychain. `lib/session.ts` is the only consumer and every screen
 * that asks whether somebody is signed in reaches it through `api/client.ts`.
 *
 * <p>An in-memory map rather than stubs returning null, for the reason
 * `react-native-mmkv`'s mock gives: a store that forgets everything makes a
 * signed-in test pass for the wrong reason.
 */
jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();

  /**
   * Whether the simulated device owner passes the prompt.
   *
   * <p>The default is `true` — a test that says nothing gets a phone whose owner
   * is present, which is the ordinary case. `__setBiometryAllowed(false)` is how
   * a test produces a dismissed prompt, and the lock's (MB-03) whole point is that the
   * keychain, not this application, is what refuses.
   */
  let biometryAllowed = true;

  /**
   * The map is keyed by service AND key, because that is what the platform does.
   * `session.ts` keeps the locked entry under its own `keychainService`, and a
   * mock that ignored the service would let the two entries overwrite each other
   * — turning "the token moved" into "the token is in both places", which is the
   * one property `enableLock` exists to have.
   */
  const at = (key: string, options?: { keychainService?: string }) =>
    `${options?.keychainService ?? ''}:${key}`;

  const guard = (options?: { requireAuthentication?: boolean }) => {
    if (options?.requireAuthentication === true && !biometryAllowed) {
      throw new Error('User canceled the authentication');
    }
  };

  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'whenPasscodeSetThisDeviceOnly',
    getItemAsync: async (key: string, options?: Record<string, unknown>) => {
      guard(options);
      return items.get(at(key, options)) ?? null;
    },
    setItemAsync: async (key: string, value: string, options?: Record<string, unknown>) => {
      // Deliberately NOT guarded. iOS prompts on a read or an update of an
      // existing value and not on creation, and a mock that asked on every write
      // would make `enableLock` untestable in the state it is meant for.
      void items.set(at(key, options), value);
    },
    deleteItemAsync: async (key: string, options?: Record<string, unknown>) => {
      void items.delete(at(key, options));
    },
    /** Test controls. Not part of the module's API; see the note above. */
    __setBiometryAllowed: (allowed: boolean) => {
      biometryAllowed = allowed;
    },
    __reset: () => {
      items.clear();
      biometryAllowed = true;
    },
    __entries: () => [...items.keys()],
  };
});

/**
 * `expo-local-authentication` — §4.12 MB-03's capability probe and in-app prompt.
 *
 * <p>Native at module load like the rest, and mocked for the same reason. The
 * default is a phone with a fingerprint reader and a finger enrolled, which is
 * the configuration most tests want to assume; `__setBiometrics` is how a test
 * asks for a device with no scanner or with nothing enrolled, which are the two
 * states the account screen has to describe rather than offer.
 */
jest.mock('expo-local-authentication', () => {
  const AuthenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 };
  let hardware = true;
  let enrolled = true;
  let kinds: number[] = [AuthenticationType.FINGERPRINT];
  let succeeds = true;

  return {
    AuthenticationType,
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
    hasHardwareAsync: async () => hardware,
    isEnrolledAsync: async () => enrolled,
    supportedAuthenticationTypesAsync: async () => kinds,
    getEnrolledLevelAsync: async () => (enrolled ? 3 : 0),
    authenticateAsync: async () =>
      succeeds ? { success: true } : { success: false, error: 'user_cancel' },
    cancelAuthenticate: async () => {},
    __setBiometrics: (state: {
      hardware?: boolean;
      enrolled?: boolean;
      kinds?: number[];
      succeeds?: boolean;
    }) => {
      hardware = state.hardware ?? hardware;
      enrolled = state.enrolled ?? enrolled;
      kinds = state.kinds ?? kinds;
      succeeds = state.succeeds ?? succeeds;
    },
    __reset: () => {
      hardware = true;
      enrolled = true;
      kinds = [AuthenticationType.FINGERPRINT];
      succeeds = true;
    },
  };
});

/**
 * The build's own configuration. `api/config.ts` throws when the origins are
 * absent — deliberately, see that file — so the mock supplies them rather than
 * leaving every test that touches the API asserting a configuration error.
 */
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '0.0.0-test',
      extra: {
        apiOrigin: 'https://api.test.invalid',
        siteUrl: 'https://test.invalid',
        eas: { projectId: 'test-project' },
      },
    },
    easConfig: null,
  },
}));

/** The device's language. One of §21.1's four, so `resolveLocale` finds a device language rather than falling back. */
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'az', languageTag: 'az-AZ' }],
}));

/** Incoming links. The parser is `lib/links.ts` and is tested directly; this is the transport. */
jest.mock('expo-linking', () => ({
  getInitialURL: async () => null,
  addEventListener: () => ({ remove: () => {} }),
  createURL: (path: string) => `ideanest://${path}`,
}));

/** Push. `lib/push.ts` calls into it at import time to set the foreground handler. */
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ granted: false, status: 'undetermined' }),
  requestPermissionsAsync: async () => ({ granted: false, status: 'denied' }),
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[test]' }),
  getLastNotificationResponseAsync: async () => null,
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  AndroidImportance: { DEFAULT: 3 },
}));

/** Whether this is a real device. False, which is what a test runner is. */
jest.mock('expo-device', () => ({ isDevice: false, deviceName: 'Test device' }));

/** The binary's version and build, which the Me tab's footer names. Fixed, so a test can read them. */
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.2.3',
  nativeBuildVersion: '45',
}));

/**
 * Connectivity — issue #150's offline banner. `lib/connectivity.ts` is the only consumer.
 *
 * <p>Online by default, which is the ordinary case. `__setNetworkState` is how a test takes
 * the phone off the network: it changes what `getNetworkStateAsync` answers AND tells the
 * listeners, as the platform does when the radio drops.
 */
jest.mock('expo-network', () => {
  const ONLINE = { type: 'WIFI', isConnected: true, isInternetReachable: true };
  let state: Record<string, unknown> = ONLINE;
  const listeners = new Set<(mockState: Record<string, unknown>) => void>();
  return {
    NetworkStateType: { NONE: 'NONE', UNKNOWN: 'UNKNOWN', CELLULAR: 'CELLULAR', WIFI: 'WIFI' },
    getNetworkStateAsync: async () => state,
    addNetworkStateListener: (listener: (mockState: Record<string, unknown>) => void) => {
      listeners.add(listener);
      return { remove: () => void listeners.delete(listener) };
    },
    useNetworkState: () => state,
    __setNetworkState: (next: Record<string, unknown>) => {
      state = next;
      for (const listener of listeners) listener(next);
    },
    __reset: () => {
      state = ONLINE;
      listeners.clear();
    },
  };
});

/**
 * The in-app browser, for the pages the app does not draw yet (`web-fallback.tsx`, the Me
 * tab's About rows). Native at module load like the rest, so merely rendering the Me tab
 * would otherwise depend on jest-expo's registry.
 */
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
}));

/**
 * Haptics — the UI kit's `ui/haptics.ts`, issue #151. Spies, so a test can assert which of the
 * five `docs/motion-system.md` §7 events a screen fired, and nothing else.
 */
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
}));

/**
 * The clipboard — the two-factor key and recovery codes, issue #161. A spy that succeeds, so a
 * test can assert exactly what was copied.
 */
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));

/**
 * The on-device image conversion behind the avatar upload, issue #161. Its native module does not
 * exist under Jest; a screen test that loads `lib/media/upload` for real must not die on import.
 * `upload.test.ts` mocks it with a spy of its own to assert the conversion.
 */
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  ImageManipulator: {
    manipulate: () => {
      throw new Error('expo-image-manipulator is not available under Jest; mock it in the test.');
    },
  },
}));

/**
 * The photo library and the camera — the UI kit's `FilePicker`, issue #151. Cancelled by default,
 * which is what a test that says nothing should get; a test that picks sets the next result.
 */
jest.mock('expo-image-picker', () => {
  let next: Record<string, unknown> = { canceled: true, assets: null };
  return {
    MediaTypeOptions: { Images: 'Images' },
    PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
    // SDK 57's own values, so a test can tell `Compatible` (HEIC transcoded) from the others.
    UIImagePickerPreferredAssetRepresentationMode: {
      Automatic: 'automatic',
      Compatible: 'compatible',
      Current: 'current',
    },
    launchImageLibraryAsync: jest.fn(async () => next),
    launchCameraAsync: jest.fn(async () => next),
    getCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
    getMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
    requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
    requestMediaLibraryPermissionsAsync: jest.fn(async () => ({
      granted: true,
      status: 'granted',
    })),
    __setNextResult: (result: Record<string, unknown>) => {
      next = result;
    },
    __reset: () => {
      next = { canceled: true, assets: null };
    },
  };
});

/**
 * The provider sign-ins (issue #152): `expo-crypto`, `expo-apple-authentication` and
 * `expo-auth-session`, each native at module load.
 *
 * <p>`expo-crypto` is real arithmetic over Node's own `crypto`, not a stub: a test of the Apple
 * nonce has to see the actual SHA-256 of what was generated, or "the hash sent equals the hash
 * given to the sheet" would pass for two equal stubs. The other two default to the person
 * closing the sheet or the browser, which is the case that must say nothing; a test that wants an
 * answer sets one with `jest.mocked(...)`.
 */
jest.mock('expo-crypto', () => {
  const { createHash, randomBytes } = require('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
    getRandomBytes: (count: number) => new Uint8Array(randomBytes(count)),
    digestStringAsync: async (_algorithm: string, data: string, options?: { encoding?: string }) =>
      createHash('sha256')
        .update(data)
        .digest(options?.encoding === 'base64' ? 'base64' : 'hex'),
  };
});

jest.mock('expo-apple-authentication', () => {
  const { Pressable } = require('react-native');
  const React = require('react');
  return {
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    isAvailableAsync: jest.fn(async () => true),
    signInAsync: jest.fn(async () => {
      throw Object.assign(new Error('The user canceled the authorization attempt.'), {
        code: 'ERR_REQUEST_CANCELED',
      });
    }),
    AppleAuthenticationButton: ({ onPress, buttonType }: { onPress: () => void; buttonType: number }) =>
      React.createElement(Pressable, { onPress, testID: `apple-native-button-${buttonType}` }),
  };
});

jest.mock('expo-auth-session', () => {
  class AuthRequest {
    static last: AuthRequest | null = null;
    /** What the next prompt answers; a test sets it. Cancelled by default. */
    static nextResult: unknown = null;
    /** Made inside `promptAsync`, as the real class does — never before it. */
    codeVerifier: string | undefined = undefined;
    readonly config: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.config = options;
      AuthRequest.last = this;
    }
    promptAsync = jest.fn(async () => {
      this.codeVerifier = 'test-code-verifier';
      return AuthRequest.nextResult ?? { type: 'cancel' };
    });
  }
  return {
    AuthRequest,
    ResponseType: { Code: 'code', Token: 'token', IdToken: 'id_token' },
    makeRedirectUri: ({ native }: { native?: string } = {}) => native ?? 'ideanest://redirect',
    exchangeCodeAsync: jest.fn(async () => ({ idToken: undefined })),
  };
});


/**
 * Expo Router, replaced by the three things the components under test use.
 *
 * <h2>Why the real one is not loaded</h2>
 *
 * Importing it pulls in the whole native stack — the toolbar, the glass effect,
 * the screen container — and several of those call
 * `requireNativeViewManager` AT MODULE LOAD. Which variant of each file resolves
 * depends on the default platform, so the suite passed on Windows and failed on
 * the Linux runner with `expo-modules-core.requireNativeViewManager is not
 * available on ios`. Mocking one module at a time was whack-a-mole through that
 * tree: `expo-glass-effect` was replaced and `expo-router/toolbar` failed next.
 *
 * <h2>It makes the tests better rather than merely greener</h2>
 *
 * A test of `ProjectCard` is a test of a card. Rendering the real navigator to
 * assert an accessible name is rendering a navigation container to check a
 * string, and it asserted nothing about the destination — the `href` went
 * unchecked because there was nothing to read it off.
 *
 * The `Link` below is a host element carrying its `href`, so a test can assert
 * where a card points. `campaign-list.test.tsx` does.
 */
jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const React = require('react');

  /*
   * Declared INSIDE the factory. Jest refuses a factory that reaches an
   * out-of-scope variable — the guard against a mock referring to something the
   * module registry has not initialised yet — and the error names the variable
   * rather than the rule, which is a minute of confusion the first time.
   *
   * An `href` is either a path or `{ pathname, params }`, and a test that had to
   * know which would be coupled to the call site rather than to the destination.
   */
  const hrefOf = (href: unknown): string => {
    if (typeof href === 'string') return href;
    if (href !== null && typeof href === 'object') {
      const { pathname, params } = href as { pathname?: string; params?: Record<string, string> };
      let path = pathname ?? '';
      for (const [name, value] of Object.entries(params ?? {})) {
        path = path.replace(`[${name}]`, value);
      }
      return path;
    }
    return '';
  };

  return {
    /**
     * A `View` carrying the destination. `asChild` is accepted and ignored: what
     * it changes is which element receives the press, and no test here presses.
     */
    Link: ({ children, href, asChild: _asChild, ...rest }: Record<string, unknown>) =>
      React.createElement(
        View,
        { ...rest, testID: 'link', accessibilityValue: { text: hrefOf(href) } },
        children,
      ),
    Stack: Object.assign(() => null, { Screen: () => null }),
    Tabs: Object.assign(() => null, { Screen: () => null }),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({}),
  };
});

/**
 * Reanimated is NOT mocked here, and that is deliberate.
 *
 * `react-native-reanimated/mock` re-exports the real module before replacing
 * parts of it, so requiring it pulls in the worklets native binding and throws.
 * `jest.config.js` points Jest at `react-native-worklets/jest/resolver.js`
 * instead, which makes the package resolve to its JavaScript half — so the real
 * Reanimated runs, `FadeInDown` is a real animation object, and a component that
 * misuses one fails here rather than on a device.
 */

/**
 * Gesture handler — `SwipeToConfirm` (#280) is the first `GestureDetector` in the app.
 *
 * <p>The library's own `jestSetup` replaces its native module and host detector with
 * the JavaScript stand-ins its `jest-utils` drive, so a test can push a pan through
 * `fireGestureHandler` and the real worklet callbacks run against the real Reanimated.
 *
 * <p>One thing it does not cover: on import it asks `react-native-worklets` for the
 * UI runtime's holder, which the JavaScript half throws on ("not supported on web"),
 * failing whichever test was running when the microtask fired. That one function is
 * answered with an empty holder; the rest of worklets is the real module.
 */
import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  getUIRuntimeHolder: () => ({}),
}));
