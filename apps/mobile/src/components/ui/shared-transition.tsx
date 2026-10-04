import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import * as Router from 'expo-router';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { spring } from '../../theme';
import { useMotionAllowed } from './motion-budget';

/**
 * Shared element transitions — `mobile-design` skill §6.3, built as a measured overlay (#279).
 *
 * <h2>Why not Reanimated's own</h2>
 *
 * The spike for #279 turned `ENABLE_SHARED_ELEMENT_TRANSITIONS` on in a release build (Reanimated
 * 4.5.5, React Native 0.86, New Architecture, the native stack under Expo Router) and ran it on an
 * Android 12 phone: the cover slid in with the page and never flew, and every push logged
 * `synchronouslyUpdateUIProps failed … Unable to find SurfaceMountingManager`. The flag is also a
 * native build switch that excludes `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS`. So the app draws the
 * flight itself and the flag stays off.
 *
 * <h2>How a flight works</h2>
 *
 * 1. The source (`useSharedSource`) is pressed. `launch` measures it in window coordinates and
 *    remembers what it shows (a {@link SharedSnapshot}). Navigation is not delayed by a frame: the
 *    press handler carries on and pushes as usual.
 * 2. The destination's {@link SharedTarget} mounts hidden, lays out, measures itself and reports.
 * 3. The host draws a clone at the destination frame, transformed (translate + scale only) to sit
 *    exactly over the source, and springs the transform to identity with `spring.soft`. When it
 *    lands, the real destination is shown under it and the clone is removed: the two are the same
 *    pixels at the same place, so the swap does not show.
 * 4. Going back runs the same flight in reverse — from the page to the card — when the page is
 *    removed by a back press, the header's back button or the hardware back key.
 *
 * <h2>What makes it fall back to a plain navigation</h2>
 *
 * Reduce Motion (the skill's §6.6), a destination that does not lay out within
 * {@link ARRIVAL_WINDOW_MS} of the press, a source that has been unmounted or recycled for another
 * item by the time the page is left (list virtualisation), a measurement that comes back empty,
 * and an interactive swipe back, which the native stack completes without asking. In each case the
 * navigation happens exactly as it would have with no shared element, because none of this ever
 * holds it up.
 */

/** A rectangle in window coordinates. */
export interface SharedFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the clone draws: the picture both ends show, in the box both ends give it. */
export interface SharedSnapshot {
  readonly uri: string | null;
  readonly radius: number;
  readonly background: string;
}

/** How long a press waits for its destination to appear before the flight is dropped. */
export const ARRIVAL_WINDOW_MS = 1000;

/** Anything with a native `measureInWindow`. */
interface Measurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

/**
 * The one measurement the module makes, behind an object so a test can answer it: the test
 * renderer's host components never call a `measureInWindow` callback back.
 */
export const sharedMeasure = {
  inWindow(node: unknown): Promise<SharedFrame | null> {
    const target = node as Partial<Measurable> | null;
    if (target === null || typeof target?.measureInWindow !== 'function') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      target.measureInWindow!((x, y, width, height) => {
        const usable = [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0;
        resolve(usable ? { x, y, width, height } : null);
      });
    });
  },
};

interface SourceEntry {
  tag: string;
  readonly node: { current: unknown };
  readonly shown: SharedValue<number>;
}

interface TargetEntry {
  readonly tag: string;
  readonly node: { current: unknown };
  readonly shown: SharedValue<number>;
}

interface Flight {
  readonly id: number;
  /** The clone drawing it: kept by a retarget or a turn-round, so the picture is never redrawn. */
  readonly clone: number;
  readonly tag: string;
  readonly direction: 'in' | 'out';
  /** Where the clone is laid out: the destination page's frame. */
  readonly page: SharedFrame;
  /** The card's frame, which the transform maps the clone onto at the card end. */
  readonly card: SharedFrame;
  readonly snapshot: SharedSnapshot;
  readonly source: SourceEntry;
  /** What the clone stands in for once it is on screen: hidden then, shown again when it lands. */
  readonly covers: readonly SharedValue<number>[];
  /**
   * A flight back that interrupts a flight in: it turns round from where the clone is, with the
   * picture already on screen, instead of starting again from the page.
   */
  readonly reversed?: boolean;
}

/** How long a clone waits for its picture to be drawn before it moves anyway. */
export const CLONE_READY_MS = 120;

interface Pending {
  readonly tag: string;
  readonly source: SourceEntry;
  readonly snapshot: SharedSnapshot;
  readonly at: number;
  from: SharedFrame | null;
  measured: boolean;
  /** A destination that laid out before the press was measured, waiting for it. */
  arrived: { readonly target: TargetEntry; readonly page: SharedFrame } | null;
}

interface Departure {
  readonly tag: string;
  readonly source: SourceEntry;
  readonly snapshot: SharedSnapshot;
  /** Where the card was when it was pressed, for when it can no longer be measured. */
  readonly from: SharedFrame | null;
}

interface SharedTransitionApi {
  readonly enabled: boolean;
  register(entry: SourceEntry): () => void;
  launch(entry: SourceEntry, snapshot: SharedSnapshot): void;
  isArriving(tag: string): boolean;
  snapshotFor(tag: string): SharedSnapshot | null;
  attach(entry: TargetEntry): () => void;
  arrive(entry: TargetEntry): void;
  depart(entry: TargetEntry): void;
}

const SharedTransitionContext = createContext<SharedTransitionApi | null>(null);

/**
 * The overlay every flight is drawn in, above the whole navigator. Mounted once, in the root
 * layout, outside `SheetHost` so the page scaling back under a sheet does not scale a clone.
 */
export function SharedTransitionHost({ children }: { readonly children: ReactNode }) {
  const enabled = useMotionAllowed('minimal');
  const [flight, setFlight] = useState<Flight | null>(null);
  const origin = useRef<View>(null);
  const live = useRef<Flight | null>(null);
  const pending = useRef<Pending | null>(null);
  const sources = useRef(new Set<SourceEntry>());
  const targets = useRef(new Map<string, TargetEntry>());
  const departures = useRef(new Map<string, Departure>());
  const ids = useRef(0);
  /** The clone's position between the card (0) and the page (1), kept across a turn-round. */
  const progress = useSharedValue(0);

  const fly = useCallback((next: (Omit<Flight, 'id' | 'clone'> & { clone?: number }) | null) => {
    ids.current += 1;
    const value = next === null ? null : { ...next, id: ids.current, clone: next.clone ?? ids.current };
    live.current = value;
    setFlight(value);
  }, []);

  const relative = useCallback(async (frame: SharedFrame): Promise<SharedFrame> => {
    const base = await sharedMeasure.inWindow(origin.current);
    if (base === null) return frame;
    return { ...frame, x: frame.x - base.x, y: frame.y - base.y };
  }, []);

  const startIn = useCallback(
    (target: TargetEntry, page: SharedFrame) => {
      const launch = pending.current;
      if (launch === null || launch.tag !== target.tag || launch.from === null) return false;
      pending.current = null;
      fly({
        tag: target.tag,
        direction: 'in',
        page,
        card: launch.from,
        snapshot: launch.snapshot,
        source: launch.source,
        covers: [launch.source.shown],
      });
      return true;
    },
    [fly],
  );

  const api = useMemo<SharedTransitionApi>(() => {
    const fresh = (launch: Pending | null, tag: string) =>
      launch !== null && launch.tag === tag && Date.now() - launch.at <= ARRIVAL_WINDOW_MS;

    const reveal = (tag: string) => {
      const target = targets.current.get(tag);
      if (target !== undefined) target.shown.value = 1;
    };

    const measureTarget = (entry: TargetEntry) => {
      void sharedMeasure.inWindow(entry.node.current).then(async (frame) => {
        if (frame === null) {
          if (fresh(pending.current, entry.tag)) pending.current = null;
          reveal(entry.tag);
          return;
        }
        const page = await relative(frame);
        const current = live.current;
        if (current !== null && current.direction === 'in' && current.tag === entry.tag) {
          if (
            current.page.x !== page.x ||
            current.page.y !== page.y ||
            current.page.width !== page.width ||
            current.page.height !== page.height
          ) {
            fly({ ...current, page });
          }
          return;
        }
        const launch = pending.current;
        if (!fresh(launch, entry.tag)) {
          reveal(entry.tag);
          return;
        }
        if (launch !== null && !launch.measured) {
          launch.arrived = { target: entry, page };
          return;
        }
        if (!startIn(entry, page)) reveal(entry.tag);
      });
    };

    return {
      enabled,
      register(entry) {
        sources.current.add(entry);
        return () => {
          sources.current.delete(entry);
          entry.shown.value = 1;
        };
      },
      launch(entry, snapshot) {
        if (!enabled) return;
        const launch: Pending = {
          tag: entry.tag,
          source: entry,
          snapshot,
          at: Date.now(),
          from: null,
          measured: false,
          arrived: null,
        };
        pending.current = launch;
        void sharedMeasure.inWindow(entry.node.current).then(async (frame) => {
          launch.measured = true;
          launch.from = frame === null ? null : await relative(frame);
          departures.current.set(entry.tag, {
            tag: entry.tag,
            source: entry,
            snapshot,
            from: launch.from,
          });
          if (launch.from === null && pending.current === launch) pending.current = null;
          if (launch.arrived === null) return;
          if (!startIn(launch.arrived.target, launch.arrived.page)) reveal(entry.tag);
        });
      },
      isArriving(tag) {
        const current = live.current;
        return (
          enabled &&
          (fresh(pending.current, tag) ||
            (current !== null && current.direction === 'in' && current.tag === tag))
        );
      },
      snapshotFor(tag) {
        const launch = pending.current;
        if (launch !== null && launch.tag === tag) return launch.snapshot;
        const current = live.current;
        if (current !== null && current.tag === tag) return current.snapshot;
        return departures.current.get(tag)?.snapshot ?? null;
      },
      attach(entry) {
        targets.current.set(entry.tag, entry);
        return () => {
          if (targets.current.get(entry.tag) === entry) targets.current.delete(entry.tag);
        };
      },
      arrive(entry) {
        measureTarget(entry);
      },
      depart(entry) {
        const back = departures.current.get(entry.tag);
        departures.current.delete(entry.tag);
        if (!enabled || back === undefined) return;
        const source = back.source;
        if (!sources.current.has(source) || source.tag !== entry.tag) return;
        const current = live.current;
        if (current !== null && current.direction === 'in' && current.tag === entry.tag) {
          fly({ ...current, direction: 'out', covers: [entry.shown, source.shown], reversed: true });
          return;
        }
        void Promise.all([
          sharedMeasure.inWindow(entry.node.current),
          sharedMeasure.inWindow(source.node.current),
        ]).then(async ([pageFrame, cardFrame]) => {
          const card = cardFrame === null ? back.from : await relative(cardFrame);
          if (pageFrame === null || card === null) return;
          if (!sources.current.has(source) || source.tag !== entry.tag) return;
          const page = await relative(pageFrame);
          fly({
            tag: entry.tag,
            direction: 'out',
            page,
            card,
            snapshot: back.snapshot,
            source,
            covers: [entry.shown, source.shown],
          });
        });
      },
    };
  }, [enabled, fly, relative, startIn]);

  const land = useCallback(
    (id: number) => {
      const current = live.current;
      if (current === null || current.id !== id) return;
      if (current.direction === 'in') {
        const target = targets.current.get(current.tag);
        if (target !== undefined) target.shown.value = 1;
      }
      current.source.shown.value = 1;
      fly(null);
    },
    [fly],
  );

  return (
    <SharedTransitionContext.Provider value={api}>
      <View style={styles.host}>
        {children}
        <View ref={origin} style={StyleSheet.absoluteFill} pointerEvents="none" collapsable={false}>
          {flight === null ? null : <Clone
              key={flight.clone}
              flight={flight}
              progress={progress}
              onLanded={land}
            />}
        </View>
      </View>
    </SharedTransitionContext.Provider>
  );
}

/** The clone: laid out at the page frame, transformed onto the card frame at the card end. */
function Clone({
  flight,
  progress,
  onLanded,
}: {
  readonly flight: Flight;
  readonly progress: SharedValue<number>;
  readonly onLanded: (id: number) => void;
}) {
  const { page, card, direction, snapshot, id, covers, reversed = false } = flight;
  const visible = useSharedValue(reversed ? 1 : 0);
  const started = useRef<number | null>(null);

  const offsetX = card.x + card.width / 2 - (page.x + page.width / 2);
  const offsetY = card.y + card.height / 2 - (page.y + page.height / 2);
  const scaleX = card.width / page.width;
  const scaleY = card.height / page.height;

  /*
   * Nothing moves and nothing is hidden until the clone's picture is on screen: a clone shown a
   * frame before its image decodes is an empty box where the card was.
   */
  const start = useCallback(() => {
    if (started.current === id) return;
    const first = started.current === null;
    started.current = id;
    visible.value = 1;
    for (const cover of covers) cover.value = 0;
    // Only a fresh clone starts from its end; a retarget or a turn-round carries on from where it is.
    if (first && !reversed) progress.value = direction === 'in' ? 0 : 1;
    progress.value = withSpring(direction === 'in' ? 1 : 0, spring.soft, (finished) => {
      if (finished === true) runOnJS(onLanded)(id);
    });
  }, [covers, direction, id, onLanded, progress, reversed, visible]);

  useEffect(() => {
    if (snapshot.uri === null || reversed) {
      start();
      return undefined;
    }
    const timer = setTimeout(start, CLONE_READY_MS);
    return () => clearTimeout(timer);
  }, [reversed, snapshot.uri, start]);

  const style = useAnimatedStyle(() => {
    const atCard = 1 - progress.value;
    return {
      opacity: visible.value,
      transform: [
        { translateX: offsetX * atCard },
        { translateY: offsetY * atCard },
        { scaleX: 1 + (scaleX - 1) * atCard },
        { scaleY: 1 + (scaleY - 1) * atCard },
      ],
    };
  });

  return (
    <Animated.View
      testID="shared-clone"
      style={[
        styles.clone,
        {
          left: page.x,
          top: page.y,
          width: page.width,
          height: page.height,
          borderRadius: snapshot.radius,
          backgroundColor: snapshot.background,
        },
        style,
      ]}
    >
      {snapshot.uri === null ? null : (
        <Image
          source={{ uri: snapshot.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={0}
          onDisplay={start}
        />
      )}
    </Animated.View>
  );
}

const NO_FLIGHTS: SharedTransitionApi = {
  enabled: false,
  register: () => () => undefined,
  launch: () => undefined,
  isArriving: () => false,
  snapshotFor: () => null,
  attach: () => () => undefined,
  arrive: () => undefined,
  depart: () => undefined,
};

function useApi(): SharedTransitionApi {
  return useContext(SharedTransitionContext) ?? NO_FLIGHTS;
}

export interface SharedSource {
  /** False under Reduce Motion or outside a host: the press should navigate plainly. */
  readonly enabled: boolean;
  /** Spread onto the `Animated.View` that wraps what flies. */
  readonly props: {
    readonly ref: RefObject<View | null>;
    readonly style: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
    readonly collapsable: false;
  };
  /** Call from the press handler, before navigating. Never delays it. */
  readonly launch: () => void;
}

/**
 * The card end of a shared element: what it shows and where it is. `tag` names the element on
 * both screens (`campaign-cover:<creator>/<slug>`), and survives recycling: a list cell reused for
 * another item re-tags itself, so a back flight never lands on somebody else's card.
 */
export function useSharedSource(tag: string, snapshot: SharedSnapshot): SharedSource {
  const api = useApi();
  const node = useRef<View>(null);
  const shown = useSharedValue(1);
  const [entry] = useState<SourceEntry>(() => ({ tag, node, shown }));
  entry.tag = tag;

  useEffect(() => api.register(entry), [api, entry]);

  const style = useAnimatedStyle((): ViewStyle => ({ opacity: shown.value }));
  const latest = useRef(snapshot);
  latest.current = snapshot;

  return {
    enabled: api.enabled,
    props: { ref: node, style, collapsable: false },
    launch: () => api.launch(entry, latest.current),
  };
}

/** True when a flight is on its way to `tag`: the screen should not run its own entry on it. */
export function useSharedArrival(tag: string): boolean {
  const api = useApi();
  const [arriving] = useState(() => api.isArriving(tag));
  return arriving;
}

/** What a flight to `tag` is carrying, so a loading screen can draw the picture it lands on. */
export function useSharedSnapshot(tag: string): SharedSnapshot | null {
  const api = useApi();
  const [snapshot] = useState(() => (api.isArriving(tag) ? api.snapshotFor(tag) : null));
  return snapshot;
}

type NavigationLike = {
  addListener?: (event: 'beforeRemove', callback: () => void) => () => void;
};

/*
 * `useNavigation` as Expo Router exports it, or nothing where a test's mock of `expo-router` leaves
 * it out: then the target simply never flies back, which is the fallback anyway.
 */
const useNavigationIfAny: () => NavigationLike | undefined =
  typeof (Router as { useNavigation?: unknown }).useNavigation === 'function'
    ? (Router.useNavigation as () => NavigationLike)
    : () => undefined;

export interface SharedTargetProps {
  readonly tag: string;
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * The page end of a shared element. Hidden while a flight is coming to it, shown when the clone
 * lands, and the start of the flight back when its screen is removed.
 */
export function SharedTarget({ tag, children, style, testID }: SharedTargetProps) {
  const api = useApi();
  const navigation = useNavigationIfAny();
  const node = useRef<unknown>(null);
  const shown = useSharedValue(api.isArriving(tag) ? 0 : 1);
  const [entry] = useState<TargetEntry>(() => ({ tag, node, shown }));

  useEffect(() => api.attach(entry), [api, entry]);

  useEffect(() => {
    if (shown.value === 1) return undefined;
    const timer = setTimeout(() => {
      shown.value = 1;
    }, ARRIVAL_WINDOW_MS * 1.5);
    return () => clearTimeout(timer);
  }, [shown]);

  useEffect(() => {
    if (typeof navigation?.addListener !== 'function') return undefined;
    return navigation.addListener('beforeRemove', () => api.depart(entry));
  }, [api, entry, navigation]);

  const onLayout = useCallback(
    (_event: LayoutChangeEvent) => {
      if (shown.value === 0) api.arrive(entry);
    },
    [api, entry, shown],
  );

  const animated = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <Animated.View
      ref={node as never}
      collapsable={false}
      onLayout={onLayout}
      style={[style, animated]}
      testID={testID}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  clone: { position: 'absolute', overflow: 'hidden' },
});
