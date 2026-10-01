import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { CircleCheck } from 'lucide-react-native';
import {
  Body,
  Card,
  Heading,
  Icon,
  Meta,
  MotionBudgetProvider,
  type IconComponent,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import { colors, formMeasure, spacing } from '../../theme';

/**
 * The frame every authentication screen sits in — the web's `(auth)/layout.tsx` and
 * `MinimalShell`, on a phone (issue #152).
 *
 * <h2>Motion: none</h2>
 *
 * `docs/motion-system.md` §5 gives authentication no entry motion, only a colour change on
 * controls. The budget is declared here, once, so no auth screen can fade, slide or scale a pill
 * under the thumb — and `FadeUp` is not imported anywhere under `features/auth`.
 *
 * <h2>One column, capped</h2>
 *
 * Full width with the standard gutter on a phone; on a tablet the column stops at
 * {@link formMeasure} and centres, because a label, a field and its error have to read as one
 * line of sight. The footer is `auth.layout.footer`, the platform's one rule, under every screen.
 */
export function AuthScreen({ children }: { readonly children: ReactNode }) {
  const t = useT('auth.layout');
  return (
    <MotionBudgetProvider level="none">
      <KeyboardAvoidingView
        style={styles.fill}
        // iOS moves the whole view; Android resizes the window itself and a second adjustment
        // there pushes the form off the top of the screen.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.column}>{children}</View>
          <Meta style={styles.footer}>{t('footer')}</Meta>
        </ScrollView>
      </KeyboardAvoidingView>
    </MotionBudgetProvider>
  );
}

/** The web's `AuthPageHeader`: the screen's title, announced as a header, and its intro. */
export function AuthHeader({ title, intro }: { readonly title: string; readonly intro?: string }) {
  return (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{title}</Heading>
      {intro === undefined ? null : <Body>{intro}</Body>}
    </View>
  );
}

/**
 * A finished outcome — an address verified, a password set, an email moved: the success icon
 * above the header. Colour, icon AND words, never colour alone; `success` and not lime, because
 * lime means "act now" and this is done (docs/ui-kit.md §2.4). The icon is decorative — the
 * header beside it says the same thing.
 */
export function SuccessHeader({ title, intro }: { readonly title: string; readonly intro: string }) {
  return (
    <View style={styles.success}>
      <Icon icon={CircleCheck} size={32} color={colors.success} />
      <AuthHeader title={title} intro={intro} />
    </View>
  );
}

/**
 * The quiet card that explains what a link or an email is — how long it lasts, what happens if
 * it is used twice. An optional decorative icon, hidden from the screen reader.
 */
export function ExplainCard({
  icon,
  children,
  testID,
}: {
  readonly icon?: IconComponent;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <Card size="sm" testID={testID}>
      <View style={styles.explain}>
        {icon === undefined ? null : <Icon icon={icon} size={20} color={colors.textTertiary} />}
        <View style={styles.explainWords}>{children}</View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  success: { gap: spacing[4] },
  explain: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  explainWords: { flex: 1, minWidth: 0, gap: spacing[2] },
  fill: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[6],
    gap: spacing[8],
  },
  column: {
    width: '100%',
    maxWidth: formMeasure,
    alignSelf: 'center',
    gap: spacing[6],
  },
  header: { gap: spacing[2] },
  footer: { textAlign: 'center', maxWidth: formMeasure, alignSelf: 'center' },
});
