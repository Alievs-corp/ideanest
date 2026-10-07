import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Alert, AppState, Keyboard, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaFrame,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  Body,
  Heading,
  Icon,
  Pill,
  SurfaceProvider,
  announce,
  haptics,
} from '../../components/ui';
import { Glyphs } from '../../icons';
import {
  acknowledgeSignedOut,
  autoPromptOnce,
  useBiometricsInUse,
  finishPinSetup,
  isCurtained,
  lockEpisode,
  lockPhase,
  migrationStall,
  runMigration,
  settleAttempts,
  setSessionEndCleanup,
  signOutFromGate,
  subscribeToLock,
  turnLockOffInstead,
  unlockWithBiometrics,
  unlockWithPin,
  type LockPhase,
} from '../../lib/app-lock';
import { biometricsUsable } from '../../lib/biometrics';
import { sweepAccountExports } from '../../lib/account-export-files';
import { useT } from '../../lib/i18n';
import { useEndLocalSession } from '../../lib/local-sign-out';
import { forgetPersistedCache } from '../../lib/offline';
import { isPinRequired } from '../../lib/session';
import { forgetUnsentEdits } from '../../lib/unsent-edits';
import { colors, radius, spacing } from '../../theme';
import { PinEntry } from './pin-entry';
import { PinCreate, biometricAction, biometricLabelKey, useBiometricCapability } from './pin-flow';

/**
 * The app lock's gate, drawn — issue #319. `lib/app-lock.ts` decides WHEN; this is WHAT.
 *
 * <h2>Above everything, including modals</h2>
 *
 * The lock can shut while a native modal is up — checkout is a full-screen modal, sign-in a
 * sheet — and a view inside the root layout would sit UNDER those. So the lock screen is drawn in
 * the layer that is above them on each platform: `FullWindowOverlay` on iOS (a view over the whole
 * key window, modal for VoiceOver), and a full-screen `Modal` on Android (a dialog window, which
 * TalkBack treats as the only thing on screen). Under it, the app keeps its place, so coming back
 * after five minutes lands where the owner left off; it is hidden from screen readers, and an
 * opaque curtain covers it while the overlay's first frame is on its way.
 *
 * <h2>What each phase shows</h2>
 *
 * - `locked`: the PIN pad on a white sheet, the biometric prompt offered once on its own (and on
 *   the pad's action key after that), and "Forgot your PIN? Sign out".
 * - `migrating` / `migration-stalled`: a pre-#319 install moving its token, behind the old item's
 *   one prompt; a refusal waits for "Try again", it is never repeated on its own.
 * - `set-pin`: the lock is on without a PIN and this launch is unlocked — choose one, or turn the
 *   lock off.
 * - `signed-out`: five wrong PINs ended the session; said once.
 *
 * <h2>The away-curtain</h2>
 *
 * With the lock on, leaving the app puts a plain curtain over it (`isCurtained`), so the screen
 * that was open is not what greets the owner — or whoever holds the phone — before the lock has
 * decided. On iOS it is drawn in the overlay layer as well, over any modal. On Android it is the
 * in-tree curtain only: opening a dialog window while the activity is in the background is not
 * something to rely on, and keeping the app switcher's snapshot clean there takes `FLAG_SECURE`,
 * which is native work.
 */

export function useLockPhase(): LockPhase {
  return useSyncExternalStore(subscribeToLock, lockPhase, lockPhase);
}

export function LockGate({ children }: { readonly children: ReactNode }) {
  const phase = useLockPhase();
  const curtained = useSyncExternalStore(subscribeToLock, isCurtained, isCurtained);
  const shut = phase !== 'open';
  const covered = shut || curtained;
  const queryClient = useQueryClient();

  // A session that ends while the gate is shut without a wipe (a refresh the service refused, a
  // token the keychain lost) has its caches emptied before the gate opens on them.
  useEffect(() => {
    setSessionEndCleanup(() => {
      queryClient.clear();
      forgetPersistedCache();
      sweepAccountExports();
      forgetUnsentEdits();
    });
    return () => setSessionEndCleanup(null);
  }, [queryClient]);

  useEffect(() => {
    // The keyboard is its own window, above any overlay; a field being typed in must let go.
    if (shut) Keyboard.dismiss();
  }, [shut]);

  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {covered ? (
        <View style={[StyleSheet.absoluteFill, styles.curtain]} testID="lock-curtain" />
      ) : null}
      {shut ? (
        <Layer>
          <LockScreen phase={phase} />
        </Layer>
      ) : curtained && Platform.OS === 'ios' ? (
        <FullWindowOverlay>
          <View style={[StyleSheet.absoluteFill, styles.curtain]} testID="lock-away-curtain" />
        </FullWindowOverlay>
      ) : null}
    </View>
  );
}

function Layer({ children }: { readonly children: ReactNode }) {
  const outerInsets = useSafeAreaInsets();
  const outerFrame = useSafeAreaFrame();
  if (Platform.OS === 'ios') {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <View style={[StyleSheet.absoluteFill, styles.curtain]}>{children}</View>
      </FullWindowOverlay>
    );
  }
  return (
    <Modal
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      // Back does not open the app. It does nothing here, as on the system's own lock screen.
      onRequestClose={() => undefined}
    >
      {/*
        The modal is its own window, drawn under the status and navigation bars
        (`statusBarTranslucent`, `navigationBarTranslucent`), so the app's insets — measured for
        a root view that may stop above a three-button navigation bar — are not its insets. A
        provider of its own measures this window; until it has, the launch reading of the whole
        window stands in.
      */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? { frame: outerFrame, insets: outerInsets }}>
        <View style={[styles.fill, styles.curtain]}>{children}</View>
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * The lock screen covers the whole window on both platforms, so its edges are the window's: never
 * less than the launch reading of the window's insets (`initialWindowMetrics`), whatever the
 * nearest provider says. A device check (#319) found the last control under a three-button
 * navigation bar when the modal was given the app root's insets.
 */
export function lockScreenInsets(insets: { readonly top: number; readonly bottom: number }): {
  readonly top: number;
  readonly bottom: number;
} {
  const window = initialWindowMetrics?.insets;
  return {
    top: Math.max(insets.top, window?.top ?? 0),
    bottom: Math.max(insets.bottom, window?.bottom ?? 0),
  };
}

export function LockScreen({ phase }: { readonly phase: LockPhase }) {
  const t = useT('mobile.lock');
  const insets = lockScreenInsets(useSafeAreaInsets());
  return (
    <View
      style={[styles.fill, { paddingTop: insets.top + spacing[6] }]}
      testID="lock-screen"
    >
      <View style={styles.brand}>
        <Icon icon={Glyphs.Lock} variant="bulk" size={32} color={colors.textPrimary} />
        <Heading accessibilityRole="header" style={styles.center}>
          {phase === 'signed-out' ? t('screen.signedOutTitle') : t('screen.title')}
        </Heading>
      </View>
      <SurfaceProvider surface="white">
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + spacing[6] }]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          testID="lock-sheet"
        >
          <PhaseBody phase={phase} />
        </ScrollView>
      </SurfaceProvider>
    </View>
  );
}

function PhaseBody({ phase }: { readonly phase: LockPhase }) {
  switch (phase) {
    case 'locked':
      return <Locked />;
    case 'migrating':
      return <Migrating />;
    case 'migration-stalled':
      return <MigrationStalled />;
    case 'set-pin':
      return <ChoosePin />;
    case 'signed-out':
      return <SignedOut />;
    case 'open':
      return null;
  }
}

/**
 * The local wipe: session, PIN, caches, unsent edits, then the service told without waiting
 * (`lib/local-sign-out.ts`). The gate stays shut until it has finished (`holdShutWhile`).
 */
function useWipe(): () => Promise<void> {
  return useEndLocalSession();
}

function Locked() {
  const t = useT('mobile.lock');
  const tAll = useT();
  const wipe = useWipe();
  const probed = useBiometricCapability();
  // The owner turned the fingerprint/face off: the PIN pad alone — no prompt, no button.
  const inUse = useBiometricsInUse();
  const capability = inUse ? probed : null;
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const pinRequired = isPinRequired();
  const reason = t('prompt');
  // A new value is a new locking — coming back after five minutes to a lock still shut.
  const episode = useSyncExternalStore(subscribeToLock, lockEpisode, lockEpisode);

  // A launch that finds five wrong PINs already counted finishes the wipe before anything else.
  useEffect(() => {
    let live = true;
    void settleAttempts(wipe).then(() => {
      if (live) setSettled(true);
    });
    return () => {
      live = false;
    };
  }, [wipe]);

  // The automatic prompt: once per locking, only while the app is in front of somebody.
  useEffect(() => {
    if (!settled || !biometricsUsable(capability)) return;
    const offer = () => void autoPromptOnce(reason);
    // Not while the app is in the background (a launch by a notification or a background task):
    // the prompt waits for the owner to bring it forward. `unknown` at a cold start is offered.
    if (AppState.currentState !== 'background') {
      offer();
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') offer();
    });
    return () => subscription.remove();
  }, [settled, capability, reason, episode]);

  const label = tAll(biometricLabelKey(capability));
  const tryBiometrics = () => void unlockWithBiometrics(reason);

  const complete = async (pin: string) => {
    const attempt = await unlockWithPin(pin, wipe);
    if (attempt.kind === 'wrong') {
      const message = t('screen.wrong', { remaining: attempt.remaining });
      haptics.pinRefused();
      setError(message);
      announce(message, { assertive: true });
    }
  };

  const footer = <ForgotPin />;

  if (pinRequired) {
    // A migrated lock that has no PIN yet: only the prompt can open it, then a PIN is chosen.
    return (
      <View style={styles.stack}>
        <Body style={styles.center}>{t('screen.confirmToSetPin')}</Body>
        {biometricsUsable(capability) ? (
          <Pill
            label={label}
            onPress={tryBiometrics}
            iconLeft={capability === 'fingerprint' ? Glyphs.FingerScan : Glyphs.Scan}
            fullWidth
            testID="lock-biometrics"
          />
        ) : null}
        {footer}
      </View>
    );
  }

  return (
    <PinEntry
      title={t('screen.enterPin')}
      error={error}
      busyLabel={t('screen.checkingPin')}
      onComplete={complete}
      disabled={!settled}
      action={biometricAction(capability, label, tryBiometrics)}
      footer={footer}
      testID="lock-pin"
    />
  );
}

/**
 * "Forgot your PIN? Sign out": asks first, then wipes this phone with the gate held shut, and tells
 * the service without waiting for it (`lib/local-sign-out.ts`).
 */
function ForgotPin() {
  const t = useT('mobile.lock.screen');
  const tAll = useT();
  const wipe = useWipe();
  const asking = useRef(false);

  const ask = () => {
    if (asking.current) return;
    asking.current = true;
    const release = () => {
      asking.current = false;
    };
    Alert.alert(
      t('forgotTitle'),
      t('forgotBody'),
      [
        { text: tAll('common.cancel'), style: 'cancel', onPress: release },
        {
          text: tAll('shell.actions.signOut'),
          style: 'destructive',
          onPress: () => void signOutFromGate(wipe).finally(release),
        },
      ],
      { cancelable: true, onDismiss: release },
    );
  };

  return <Pill label={t('forgot')} onPress={ask} variant="ghost" fullWidth testID="lock-forgot" />;
}

function Migrating() {
  const t = useT('mobile.lock.screen');
  return (
    <View style={styles.stack} accessible accessibilityState={{ busy: true }}>
      <Body style={styles.center}>{t('migrating')}</Body>
    </View>
  );
}

function MigrationStalled() {
  const t = useT('mobile.lock.screen');
  const tAll = useT();
  const stall = migrationStall();
  return (
    <View style={styles.stack}>
      <Body style={styles.center} accessibilityRole="alert">
        {stall === 'failed' ? t('migrationFailed') : t('migrationRefused')}
      </Body>
      <Pill
        label={tAll('common.tryAgain')}
        onPress={() => void runMigration()}
        variant="primary"
        fullWidth
        testID="lock-migration-retry"
      />
      <ForgotSignOutOnly />
    </View>
  );
}

/** Signing out from a stalled migration: no PIN exists yet, so it is the only other way on. */
function ForgotSignOutOnly() {
  const tAll = useT();
  const wipe = useWipe();
  // A second tap before the first wipe finished would nest a second one.
  const going = useRef(false);
  return (
    <Pill
      label={tAll('shell.actions.signOut')}
      onPress={() => {
        if (going.current) return;
        going.current = true;
        void signOutFromGate(wipe).finally(() => {
          going.current = false;
        });
      }}
      variant="ghost"
      fullWidth
      testID="lock-sign-out"
    />
  );
}

function ChoosePin() {
  const t = useT('mobile.lock');
  return (
    <PinCreate
      intro={t('setPin.migrationIntro')}
      onCreated={async (pin) => {
        await finishPinSetup(pin);
        announce(t('setPin.saved'));
      }}
      footer={
        <Pill
          label={t('setPin.turnOff')}
          onPress={() => void turnLockOffInstead()}
          variant="ghost"
          fullWidth
          testID="lock-turn-off"
        />
      }
      testID="lock-set-pin"
    />
  );
}

function SignedOut() {
  const t = useT('mobile.lock.screen');
  return (
    <View style={styles.stack}>
      <Body style={styles.center} accessibilityRole="alert">
        {t('signedOutBody')}
      </Body>
      <Pill
        label={t('continue')}
        onPress={acknowledgeSignedOut}
        variant="primary"
        fullWidth
        testID="lock-signed-out-continue"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  curtain: { backgroundColor: colors.surface1 },
  brand: {
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[6],
    paddingBottom: spacing[8],
  },
  center: { textAlign: 'center' },
  sheet: {
    flex: 1,
    backgroundColor: colors.whiteSurface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  sheetBody: { flexGrow: 1, padding: spacing[6], justifyContent: 'flex-end' },
  stack: { gap: spacing[4] },
});
