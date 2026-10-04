import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { announce } from './announce';
import { Icon } from './icon';
import { TONES, useSurface, type Surface } from './surface';

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
 *   <li>The error is rendered, stays reachable by swiping, and is announced assertively the
 *       moment it appears (the web's `role="alert"`). It is ALSO put at the front of the
 *       control's `accessibilityHint`, because the announcement is heard once: somebody who
 *       swipes back to the field later has to hear what is wrong with it there. React Native
 *       has no `aria-invalid` — the prop does not exist in 0.86 — so the hint is the only place
 *       an invalid state can travel with the control.</li>
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
 * `--danger` with a `Warning2` icon and a sentence. A red border alone says nothing to a screen
 * reader and nothing to somebody who cannot see red (§9.2). Lime never marks an error: lime is
 * urgent. On a white sheet `--danger` text measures about 3.4:1, under AA for a caption, so there
 * the sentence is in the surface's primary ink and the icon and border carry the danger
 * ({@link errorTextColor}).
 *
 * <p>The error appears on the render that sets it and leaves on the one that clears it — never
 * faded or slid in (`mobile-design` skill §6.4): an error that animates in is read late.
 *
 * <h2>Grouped: the question is a header</h2>
 *
 * `grouped` is for a SET of separately focusable controls — a radio group, a list of checkboxes —
 * where the label is the question and each option has its own name. There is no one element to
 * carry the question: VoiceOver on the new architecture does not read a container's
 * `accessibilityLabel` unless the container is itself `accessible`, and an accessible container
 * swallows the options inside it. So in a grouped field the visible label IS the stop: one header
 * ("Delivery, required, heading") read right before the first option and reachable from the
 * rotor's headings list. The hint and the error below the options stay readable too, since there
 * is no single control to carry them.
 *
 * <p>A `Select` or a `FilePicker` is ONE control even though it opens a list, so it takes an
 * ordinary field, not a grouped one.
 */

export interface FieldControlContext {
  /** The plain label, for visible text such as a sheet's title. */
  readonly label: string;
  /** The accessible name: the label, with the required word when required. */
  readonly accessibilityLabel: string;
  /** The hint, as written. */
  readonly hint: string | undefined;
  /** The error sentence while there is one. */
  readonly error: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
  readonly grouped: boolean;
}

const FieldContext = createContext<FieldControlContext | null>(null);

/**
 * Sentences for one `accessibilityHint`, in the order they should be heard. A part that does not
 * end a sentence gets a full stop, so a screen reader pauses between them instead of running an
 * error into a hint.
 */
export function hintOf(parts: readonly (string | null | undefined)[]): string | undefined {
  const kept = parts.map((part) => part?.trim() ?? '').filter((part) => part !== '');
  if (kept.length === 0) return undefined;
  return kept
    .map((part, index) => (index < kept.length - 1 && !/[.!?…]$/u.test(part) ? `${part}.` : part))
    .join(' ');
}

/** What a control inside a `Field` inherits. Explicit props win, so a control works standalone. */
export function useFieldControl(own: {
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  invalid?: boolean | undefined;
}): {
  /** The plain label — the control's own name, or the field's label. For visible text. */
  readonly label: string | undefined;
  readonly accessibilityLabel: string | undefined;
  /** The field's error first, then the hint: what is wrong matters more than the guidance. */
  readonly accessibilityHint: string | undefined;
  readonly invalid: boolean;
  readonly inField: boolean;
} {
  const field = useContext(FieldContext);
  return {
    label: own.accessibilityLabel ?? field?.label,
    accessibilityLabel: own.accessibilityLabel ?? field?.accessibilityLabel,
    accessibilityHint: hintOf([field?.error, own.accessibilityHint ?? field?.hint]),
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
  /** For a set of separately focusable controls: radios, a list of checkboxes. */
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

  const labelAccessibility = grouped
    ? { accessible: true, accessibilityRole: 'header' as const, accessibilityLabel: name }
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

  return (
    <FieldContext.Provider
      value={{
        label,
        accessibilityLabel: name,
        hint: hinted ? hint : undefined,
        error: errored ? error : undefined,
        invalid: errored,
        required,
        grouped,
      }}
    >
      <View style={styles.field} testID={testID}>
        {/*
         * A single control carries these words as its name, so the label is hidden: read twice, a
         * label is noise. A grouped field has no single control, so the label is the one stop that
         * asks the question — a header, the required word included.
         */}
        <View style={styles.labelRow} {...labelAccessibility}>
          <Text style={[styles.label, { color: tones.primary }]}>{label}</Text>
          {required ? (
            <Text style={[styles.required, { color: tones.tertiary }]}>{t('required')}</Text>
          ) : null}
        </View>

        {children}

        {hinted ? (
          <Text
            style={[styles.caption, { color: tones.secondary }]}
            // A single control's `accessibilityHint` already reads it; a group has no such place.
            accessibilityElementsHidden={!grouped}
            importantForAccessibility={grouped ? 'auto' : 'no'}
          >
            {hint}
          </Text>
        ) : null}

        {errored ? (
          <View style={styles.error} accessible accessibilityLabel={error}>
            <View style={styles.errorIcon}>
              <Icon icon={Glyphs.Warning2} size={14} color={colors.danger} />
            </View>
            <Text style={[styles.caption, styles.errorText, { color: errorTextColor(surface) }]}>
              {error}
            </Text>
          </View>
        ) : null}
      </View>
    </FieldContext.Provider>
  );
}

/**
 * The colour of an error or refusal sentence on a surface: `--danger` where it is legible (the dark
 * canvas), the surface's primary ink on white, where danger text fails AA. The icon beside it stays
 * `--danger` everywhere — a glyph needs 3:1, which danger meets on white.
 */
export function errorTextColor(surface: Surface): string {
  return surface === 'white' ? TONES.white.primary : colors.danger;
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
  errorText: { flexShrink: 1 },
});
