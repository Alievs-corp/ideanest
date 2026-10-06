import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { InlineAlert, Pill } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { explainerSnoozed, registerForPush, snoozeExplainer } from '../../lib/push';
import { spacing } from '../../theme';
import { usePushPermission } from '../settings/notifications/push-permission';

export type ExplainerMoment = 'pledge' | 'follow' | 'save';

const BODY = {
  pledge: 'mobile.notifications.explainer.pledgeBody',
  follow: 'mobile.notifications.explainer.followBody',
  save: 'mobile.notifications.explainer.saveBody',
} as const;

/**
 * The in-app card that asks before the system does — #160's contextual prompt.
 *
 * <p>Shown at a moment a notification obviously helps (a pledge just collected, a creator just
 * followed, a campaign just saved), and only while the phone has not decided: a phone that allows
 * it is registered without asking, and one that refused is never asked again (the settings screen
 * points to the phone's settings instead). "Turn on" runs {@link registerForPush}, the one call
 * that may show the system prompt; "Not now" keeps the card away for thirty days on this phone.
 */
export function PushExplainer({ moment, testID }: { readonly moment: ExplainerMoment; readonly testID?: string }) {
  const t = useT('mobile.notifications.explainer');
  const tAll = useT();
  const { permission } = usePushPermission();
  const [settled, setSettled] = useState(() => explainerSnoozed());
  const [asking, setAsking] = useState(false);

  if (settled || permission !== 'undetermined') return null;

  const turnOn = async () => {
    setAsking(true);
    try {
      await registerForPush();
    } catch {
      // Whatever the phone answered, the settings screen says it from here on.
    } finally {
      setAsking(false);
      setSettled(true);
    }
  };

  return (
    <InlineAlert
      variant="info"
      politeness="polite"
      title={t('title')}
      description={tAll(BODY[moment])}
      action={
        <View style={styles.actions}>
          <Pill
            label={t('turnOn')}
            size="sm"
            busy={asking}
            onPress={() => void turnOn()}
            testID="push-explainer-on"
          />
          <Pill
            label={t('notNow')}
            size="sm"
            variant="ghost"
            disabled={asking}
            onPress={() => {
              snoozeExplainer();
              setSettled(true);
            }}
            testID="push-explainer-later"
          />
        </View>
      }
      testID={testID ?? 'push-explainer'}
    />
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
});
