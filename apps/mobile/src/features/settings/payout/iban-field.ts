import { useRef, useState } from 'react';
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native';
import { caretAfterFormatting, formatIban, normaliseIban } from '@ideanest/account/iban';

/**
 * The grouped IBAN field's keystrokes, on a phone (#419) — the web's `reformatIban`, for an input
 * that does not say where its caret is.
 *
 * <h2>Why the app needs its own</h2>
 *
 * React Native's `onChangeText` hands over the new text and nothing else. Regrouping that text in
 * fours is easy, but a backspace over one of the grouping spaces removes only the space, and the
 * grouping puts it straight back: the key did nothing. To apply the deletion to the character
 * before the space instead, the field has to know where the edit was, and afterwards it has to put
 * the caret where the person expects it, because the regrouped text is not what the native input
 * holds.
 *
 * <h2>Where the edit was</h2>
 *
 * {@link editIban} reads the edit from the previous text and the new one. The selection last
 * reported by `onSelectionChange` is a hint: when it explains the change (a backspace from it, or
 * a replacement of it) it is taken, because it is exact inside a run of equal characters, where a
 * comparison of the two texts cannot tell which `0` went. When it does not explain the change —
 * none was reported yet, or the platform reported the caret after the edit rather than before —
 * the common prefix and suffix of the two texts say where the edit was. Either way a deleted lone
 * grouping space is read as a backspace, never a forward delete: a phone keyboard has no forward
 * delete key, and a hint that arrived late would otherwise turn the backspace around.
 *
 * <h2>Where the caret goes</h2>
 *
 * {@link useIbanField} puts the caret through the controlled `selection` prop, which React Native
 * sends in the same native command as the regrouped text, and releases it on the next caret move,
 * as `StoryTextField` does, so it never fights the person's own taps. One report is not a caret
 * move: the native input's own caret in the text it held before the regrouping, which can arrive
 * after the change. That one is skipped, so the regrouped caret stands.
 */

export interface IbanSelection {
  readonly start: number;
  readonly end: number;
}

export interface IbanFieldEdit {
  /** The field's text: grouped in fours, upper case. */
  readonly value: string;
  /** Where the caret belongs in {@link value}. */
  readonly caret: number;
  /** Where the native input left its caret, in the text it was given before the regrouping. */
  readonly typedCaret: number;
}

/** The edit as one replacement: `previous[start, removedEnd)` became `typed[start, insertedEnd)`. */
interface Replacement {
  readonly start: number;
  readonly removedEnd: number;
  readonly insertedEnd: number;
}

/**
 * One edit to the grouped field. `previous` is what the field showed, `selection` the selection
 * last reported for it (null if none was), and `typed` the text `onChangeText` reported.
 */
export function editIban(previous: string, selection: IbanSelection | null, typed: string): IbanFieldEdit {
  const edit = fromSelection(previous, selection, typed) ?? fromComparison(previous, typed);
  let text = typed;
  let at = edit.insertedEnd;
  const removed = previous.slice(edit.start, edit.removedEnd);
  if (edit.insertedEnd === edit.start && removed !== '' && normaliseIban(removed) === '') {
    // Only grouping space went, which the grouping would put back: the character before it goes.
    const before = lastCharacterBefore(typed, edit.start);
    if (before >= 0) {
      text = typed.slice(0, before) + typed.slice(before + 1);
      at = before;
    }
  }
  return { value: formatIban(text), caret: caretAfterFormatting(text, at), typedCaret: edit.insertedEnd };
}

/** The edit as the reported selection explains it, or null when it does not. */
function fromSelection(previous: string, selection: IbanSelection | null, typed: string): Replacement | null {
  if (selection === null) return null;
  const { start, end } = selection;
  if (start < 0 || start > end || end > previous.length) return null;
  const deleted = previous.length - typed.length;
  // A backspace from a caret: the characters before it went.
  if (start === end && deleted > 0 && start >= deleted) {
    if (typed === previous.slice(0, start - deleted) + previous.slice(start)) {
      return { start: start - deleted, removedEnd: start, insertedEnd: start - deleted };
    }
  }
  // Typing at the caret, or pasting or deleting over the selection.
  const kept = previous.length - end;
  if (typed.length >= start + kept && typed.startsWith(previous.slice(0, start)) && typed.endsWith(previous.slice(end))) {
    return { start, removedEnd: end, insertedEnd: typed.length - kept };
  }
  return null;
}

/** The edit as the two texts' common prefix and suffix place it. */
function fromComparison(previous: string, typed: string): Replacement {
  const shorter = Math.min(previous.length, typed.length);
  let prefix = 0;
  while (prefix < shorter && previous[prefix] === typed[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    previous[previous.length - 1 - suffix] === typed[typed.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { start: prefix, removedEnd: previous.length - suffix, insertedEnd: typed.length - suffix };
}

function lastCharacterBefore(text: string, index: number): number {
  let at = index - 1;
  while (at >= 0 && normaliseIban(text[at]) === '') at -= 1;
  return at;
}

type SelectionEvent = NativeSyntheticEvent<TextInputSelectionChangeEventData>;

/**
 * The IBAN field's state and the `TextInput` props that keep it: `value`, `selection`,
 * `onChangeText` and `onSelectionChange`. `onEdit` runs after every change the person makes;
 * `reset` replaces the text from code, as emptying the field after a save does.
 */
export function useIbanField(onEdit?: () => void) {
  const [value, setValue] = useState('');
  /** Set by every change to put the caret back; released on the next caret move. */
  const [forced, setForced] = useState<IbanSelection | null>(null);
  // Refs, not state: two native events can arrive before the next render.
  const current = useRef('');
  const known = useRef<IbanSelection | null>(null);
  const stale = useRef<number | null>(null);

  function onChangeText(typed: string): void {
    const next = editIban(current.current, known.current, typed);
    const reported = known.current;
    const caretMoved = reported === null || reported.start !== next.typedCaret || reported.end !== next.typedCaret;
    // The native input reports its own caret for `typed` once it moves, which is not where it ends up.
    stale.current = caretMoved && next.typedCaret !== next.caret ? next.typedCaret : null;
    const caret = { start: next.caret, end: next.caret };
    current.current = next.value;
    known.current = caret;
    setValue(next.value);
    setForced(caret);
    onEdit?.();
  }

  function onSelectionChange(event: SelectionEvent): void {
    const { start, end } = event.nativeEvent.selection;
    const expected = stale.current;
    stale.current = null;
    if (expected !== null && start === expected && end === expected) return;
    known.current = { start, end };
    setForced(null);
  }

  function reset(text: string): void {
    const next = formatIban(text);
    current.current = next;
    known.current = null;
    stale.current = null;
    setValue(next);
    setForced(null);
  }

  return { value, selection: forced ?? undefined, onChangeText, onSelectionChange, reset };
}
