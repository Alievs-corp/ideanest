import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { announce } from './announce';
import { Icon } from './icon';
import { TONES, useSurface } from './surface';

/**
 * The wrapper every form control composes with — the native `Field` (`docs/ui-kit.md` §7.13).
 *
 * <h2>What the web wires with ids, the phone wires with props</h2>
 *
 * The web's `Field` generates ids and hands the control `htmlFor`, `aria-describedby` and
 * `aria-invalid`, so no caller has to remember them. React Native has no ids to point at: a
 * screen reader reads ONE element's `accessibilityLabel` and `accessibilityHint`. So the same
 * wiring travels down as context, and every control in this kit reads it with `useFieldControl`:
 *
 * <ul>
 *   <li>The label is visible text AND the control's accessible name. The visible label is hidden
 *       from the screen reader, because the control already says it — two stops for one word is
 *       the duplication the web avoids with `<label for>`.</li>
 *   <li>The hint becomes the control's `accessibilityHint`, read after a pause, which is where
 *       the web's `aria-describedby` puts it too.</li>
 *   <li>The error is rendered, stays reachable by swiping, is announced assertively the moment it
 *       appears (the web's `role="alert"`), and marks the control `aria-invalid`.</li>
 * </ul>
 *
 * <h2>Required is a word, never only an asterisk</h2>
 *
 * The web draws a white/40 asterisk and relies on `required` on the input for screen readers.
 * React Native has no `required` state, and an asterisk is punctuation VoiceOver may not read at
 * all. So the required state is the catalogue's word — visibly beside the label, and inside the
 * accessible name ("Email address, required") — in every language the catalogue carries.
 *
 * <h2>An error is text plus an icon, never a colour</h2>
 *
 * `--danger` with `CircleAlert` and a sentence. A red border alone says nothing to a screen reader
 * and nothing to somebody who cannot see red (§9.2). Lime never marks an error: lime is urgent.
 *
 * <p>`grouped` is for a control that is a SET — a radio group, a picker, a file picker — where the
 * label names the group rather than one input. The control reads the same context either way.
 */

export interface FieldControlContext {
  /** The accessible name: the label, with the required word when required. */
  readonly accessibilityLabel: string;
  /** The hint, as the control's `accessibilityHint`. */
  readonly accessibilityHint: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
  readonly grouped: boolean;
}

const FieldContext = createContext<FieldControlContext | null>(null);

/** What a control inside a `Field` inherits. Explicit props win, so a control works standalone. */
export function useFieldControl(own: {
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  invalid?: boolean | undefined;
}): {
  readonly accessibilityLabel: string | undefined;
  readonly accessibilityHint: string | undefined;
  readonly invalid: boolean;
  readonly inField: boolean;
} {
  const field = useContext(FieldContext);
  return {
    accessibilityLabel: own.accessibilityLabel ?? field?.accessibilityLabel,
    accessibilityHint: own.accessibilityHint ?? field?.accessibilityHint,
    invalid: own.invalid ?? field?.invalid ?? false,
    inField: field !== null,
  };
}

export interface FieldProps {
  /** The visible label and the control's accessible name. */
  readonly label: string;
  /** Guidance shown before the user gets it wrong. Becomes the control's `accessibilityHint`. */
  readonly hint?: string;
  /** Present and non-empty means errored. The sentence is announced; the colour is not the message. */
  readonly error?: string | null;
  /** Says "required" in words, visibly and in the accessible name. */
  readonly required?: boolean;
  /** For a control that is a set: radios, a select, a file picker. */
  readonly grouped?: boolean;
  readonly children: ReactNode;
  readonly testID?: string;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  grouped = false,
  children,
  testID,
}: FieldProps) {
  const t = useT('mobile.kitForm');
  const surface = useSurface();
  const tones = TONES[surface];
  const errored = error !== undefined && error !== null && error !== '';
  const hinted = hint !== undefined && hint !== '';

  const name = required ? t('requiredLabel', { label }) : label;

  useErrorAnnouncement(errored ? error : undefined);

  return (
    <FieldContext.Provider
      value={{
        accessibilityLabel: name,
        accessibilityHint: hinted ? hint : undefined,
        invalid: errored,
        required,
        grouped,
      }}
    >
      <View style={styles.field} testID={testID}>
        {/*
         * Hidden from the screen reader: the control carries the same words as its name, and a
         * grouped control names its group with them. Read twice, a label is noise.
         */}
        <View
          style={styles.labelRow}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[styles.label, { color: tones.primary }]}>{label}</Text>
          {required ? (
            <Text style={[styles.required, { color: tones.tertiary }]}>{t('required')}</Text>
          ) : null}
        </View>

        {children}

        {hinted ? (
          <Text
            style={[styles.caption, { color: tones.secondary }]}
            // The control's `accessibilityHint` already reads it.
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {hint}
          </Text>
        ) : null}

        {errored ? (
          <View style={styles.error} accessible accessibilityLabel={error}>
            <View style={styles.errorIcon}>
              <Icon icon={CircleAlert} size={14} color={colors.danger} />
            </View>
            <Text style={[styles.caption, styles.errorText]}>{error}</Text>
          </View>
        ) : null}
      </View>
    </FieldContext.Provider>
  );
}

/**
 * Announce an error when it appears or changes, and not on every render.
 *
 * <p>Assertive, because an error is the web's `role="alert"`: somebody who pressed submit and
 * heard nothing believes it worked. The same sentence twice in a row is not repeated — a
 * re-render is not a new error.
 */
function useErrorAnnouncement(error: string | undefined): void {
  const last = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (error === undefined) {
      last.current = undefined;
      return;
    }
    if (error === last.current) return;
    last.current = error;
    announce(error, { assertive: true });
  }, [error]);
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing[2],
  },
  label: {
    ...font.medium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
  required: {
    ...font.regular,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
  },
  caption: {
    ...font.regular,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
  },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  // Centres the 14pt icon on the first 21pt line, where the web's `mt-0.5` puts it.
  errorIcon: { paddingTop: (lineHeight.small - 14) / 2 },
  errorText: { flexShrink: 1, color: colors.danger },
});
