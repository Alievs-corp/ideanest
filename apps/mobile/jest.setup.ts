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
 * `@shopify/flash-list`, `react-native-safe-area-context` and
 * `react-native-gesture-handler`, all of which ship working JavaScript
 * implementations and are exercised for real.
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
   * a test produces a dismissed prompt, and #29's whole point is that the
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
 * `expo-local-authentication` — issue #29's capability probe and in-app prompt.
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
      React.createElement(View, { ...rest, testID: 'link', accessibilityValue: { text: hrefOf(href) } }, children),
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
