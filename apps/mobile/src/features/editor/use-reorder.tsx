import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from 'react-native';
import { IconButton, announce } from '../../components/ui';
import { FOCUS_DELAY_MS, focusOn } from '../../components/ui/overlay';
import { Glyphs } from '../../icons';
import { spacing } from '../../theme';

/**
 * Reordering a list by buttons and by the screen reader's actions — rewards, story blocks and
 * questions (#162, "Native decisions: Reorder").
 *
 * <h2>Contract</h2>
 *
 * `useReorder({ items, idOf, send, onRefused, announcement, labels, onDelete?, onSaved? })`:
 * <ul>
 *   <li>`items` — the list in the server's order. The hook returns `items` in the DISPLAY order,
 *       which runs ahead of the server while a move is unconfirmed.</li>
 *   <li>`move(id, 'up' | 'down')` — optimistic: the list moves at once, "{Type} moved to position
 *       N of M" is announced (`announcement(item, position, total)`, the caller's words), and
 *       screen-reader focus returns to the same button on the moved card (or its twin, when the
 *       card reached the end and that button is disabled).</li>
 *   <li>`send(ids)` — called with the FULL id list in the new order. One request at a time; moves
 *       made while one is in the air are coalesced into ONE queued request carrying the latest
 *       full list. When the server's `items` arrive in the same order, the optimistic order is
 *       dropped; `onSaved(ids)` lets the caller update its cache so they do.</li>
 *   <li>`onRefused(cause)` — the service refused: the optimistic order is dropped (the server's
 *       order shows again) and the caller explains and reloads.</li>
 *   <li>`accessibilityFor(item)` — spread onto the card: `accessibilityActions` moveUp / moveDown
 *       (only where possible) and delete (when `onDelete` is given), with `labels`' names, and the
 *       handler that runs them.</li>
 *   <li>`<ReorderButtons reorder={…} id={…} upLabel downLabel />` — the visible move up / move down
 *       buttons (44pt targets), whose names should include the type and position.</li>
 * </ul>
 * A drag handle is not part of this; buttons and actions are the accessible mechanism.
 */

export type MoveDirection = 'up' | 'down';

export interface ReorderLabels {
  readonly moveUp: string;
  readonly moveDown: string;
  readonly delete?: string;
}

export interface ReorderOptions<T> {
  readonly items: readonly T[];
  readonly idOf: (item: T) => string;
  readonly send: (ids: readonly string[]) => Promise<unknown>;
  readonly onRefused: (cause: unknown) => void;
  readonly onSaved?: (ids: readonly string[]) => void;
  readonly announcement: (item: T, position: number, total: number) => string;
  readonly labels: ReorderLabels;
  readonly onDelete?: (item: T) => void;
}

export interface Reorder<T> {
  readonly items: readonly T[];
  /** A reorder request is in the air. */
  readonly pending: boolean;
  readonly move: (id: string, direction: MoveDirection) => void;
  readonly canMove: (id: string, direction: MoveDirection) => boolean;
  /** The ref for a card's move button, so focus can come back to it after the move. */
  readonly buttonRef: (id: string, direction: MoveDirection) => (node: View | null) => void;
  readonly accessibilityFor: (item: T) => {
    readonly accessibilityActions: AccessibilityActionInfo[];
    readonly onAccessibilityAction: (event: AccessibilityActionEvent) => void;
  };
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function useReorder<T>({
  items,
  idOf,
  send,
  onRefused,
  onSaved,
  announcement,
  labels,
  onDelete,
}: ReorderOptions<T>): Reorder<T> {
  const [order, setOrder] = useState<readonly string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ id: string; direction: MoveDirection; at: number } | null>(null);
  const orderRef = useRef<readonly string[] | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<readonly string[] | null>(null);
  const buttons = useRef(new Map<string, View>());

  const latest = useRef({ send, onRefused, onSaved, announcement, onDelete });
  useEffect(() => {
    latest.current = { send, onRefused, onSaved, announcement, onDelete };
  });

  const serverIds = useMemo(() => items.map(idOf), [items, idOf]);
  const byId = useMemo(() => new Map(items.map((item) => [idOf(item), item])), [items, idOf]);

  // The server caught up: its order is the one shown, so the optimistic copy can go.
  useEffect(() => {
    if (!inFlight.current && orderRef.current !== null && sameOrder(orderRef.current, serverIds)) {
      orderRef.current = null;
      setOrder(null);
    }
  }, [serverIds, pending]);

  const display = useMemo(() => {
    if (order === null) return items;
    const shown = order.flatMap((id) => {
      const item = byId.get(id);
      return item === undefined ? [] : [item];
    });
    // Anything the server has that the optimistic order has not heard of goes at the end.
    return [...shown, ...items.filter((item) => !order.includes(idOf(item)))];
  }, [order, items, byId, idOf]);

  const currentIds = useCallback(
    (): readonly string[] => orderRef.current ?? serverIds,
    [serverIds],
  );

  const dispatch = useCallback((ids: readonly string[]): void => {
    if (inFlight.current) {
      queued.current = ids;
      return;
    }
    inFlight.current = true;
    setPending(true);
    latest.current.send(ids).then(
      () => {
        inFlight.current = false;
        const next = queued.current;
        queued.current = null;
        if (next !== null) {
          dispatch(next);
          return;
        }
        setPending(false);
        latest.current.onSaved?.(ids);
      },
      (cause: unknown) => {
        inFlight.current = false;
        queued.current = null;
        orderRef.current = null;
        setOrder(null);
        setPending(false);
        latest.current.onRefused(cause);
      },
    );
  }, []);

  const canMove = useCallback(
    (id: string, direction: MoveDirection): boolean => {
      const ids = currentIds();
      const index = ids.indexOf(id);
      if (index < 0) return false;
      return direction === 'up' ? index > 0 : index < ids.length - 1;
    },
    [currentIds],
  );

  const move = useCallback(
    (id: string, direction: MoveDirection): void => {
      const ids = currentIds();
      const index = ids.indexOf(id);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= ids.length) return;
      const next = [...ids];
      next[index] = next[target] as string;
      next[target] = id;
      orderRef.current = next;
      setOrder(next);
      const item = byId.get(id);
      if (item !== undefined) announce(latest.current.announcement(item, target + 1, next.length));
      setFocusTarget({ id, direction, at: Date.now() });
      dispatch(next);
    },
    [currentIds, byId, dispatch],
  );

  // Focus back on the button that was pressed, now on the card in its new place.
  useEffect(() => {
    if (focusTarget === null) return undefined;
    const { id, direction } = focusTarget;
    const timer = setTimeout(() => {
      const ids = orderRef.current ?? serverIds;
      const index = ids.indexOf(id);
      const atEdge = direction === 'up' ? index === 0 : index === ids.length - 1;
      const twin: MoveDirection = direction === 'up' ? 'down' : 'up';
      focusOn(buttons.current.get(`${id}:${atEdge ? twin : direction}`));
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusTarget, serverIds]);

  const buttonRef = useCallback(
    (id: string, direction: MoveDirection) => (node: View | null) => {
      const key = `${id}:${direction}`;
      if (node === null) buttons.current.delete(key);
      else buttons.current.set(key, node);
    },
    [],
  );

  const accessibilityFor = useCallback(
    (item: T) => {
      const id = idOf(item);
      const actions: AccessibilityActionInfo[] = [];
      if (canMove(id, 'up')) actions.push({ name: 'moveUp', label: labels.moveUp });
      if (canMove(id, 'down')) actions.push({ name: 'moveDown', label: labels.moveDown });
      if (labels.delete !== undefined && latest.current.onDelete !== undefined) {
        actions.push({ name: 'delete', label: labels.delete });
      }
      return {
        accessibilityActions: actions,
        onAccessibilityAction: (event: AccessibilityActionEvent) => {
          const name = event.nativeEvent.actionName;
          if (name === 'moveUp') move(id, 'up');
          else if (name === 'moveDown') move(id, 'down');
          else if (name === 'delete') latest.current.onDelete?.(item);
        },
      };
    },
    [idOf, canMove, labels.moveUp, labels.moveDown, labels.delete, move],
  );

  return { items: display, pending, move, canMove, buttonRef, accessibilityFor };
}

/** The visible move up / move down pair for one card. The names carry the type and position. */
export function ReorderButtons<T>({
  reorder,
  id,
  upLabel,
  downLabel,
  disabled = false,
  testID,
}: {
  readonly reorder: Reorder<T>;
  readonly id: string;
  readonly upLabel: string;
  readonly downLabel: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}) {
  return (
    <View style={styles.buttons}>
      <IconButton
        ref={reorder.buttonRef(id, 'up')}
        icon={Glyphs.ArrowUp}
        label={upLabel}
        variant="ghost"
        disabled={disabled || !reorder.canMove(id, 'up')}
        onPress={() => reorder.move(id, 'up')}
        testID={testID === undefined ? undefined : `${testID}-up`}
      />
      <IconButton
        ref={reorder.buttonRef(id, 'down')}
        icon={Glyphs.ArrowDown}
        label={downLabel}
        variant="ghost"
        disabled={disabled || !reorder.canMove(id, 'down')}
        onPress={() => reorder.move(id, 'down')}
        testID={testID === undefined ? undefined : `${testID}-down`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: spacing[1] },
});
