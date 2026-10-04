import { createRef, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, KeyboardAvoidingView, StyleSheet, Text, View } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors, radius, shadow, tint } from '../../theme';
import { Body } from '../text';
import { DIALOG_ENTRY_SCALE, DIALOG_RISE, Dialog } from './dialog';
import { MotionBudgetProvider } from './motion-budget';
import { Pill } from './pill';
import { SHEET_PAGE_SCALE, SheetHost } from './sheet';
import { TONES } from './surface';

/**
 * The dialog's contract is the web modal's focus trap, rebuilt from native parts: focus goes in
 * to the title and back out to the opener, the platform's own dismissals close it, and the white
 * panel switches everything inside it to on-white tones.
 */

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

const renderEn = (ui: ReactElement) => render(ui, { wrapper: English });

const TITLE = 'Delete this reward?';

type FocusCall = [unknown, string];

/** The elements focus was sent to, in order. */
function focusTargets(): unknown[] {
  return (jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls as FocusCall[])
    .filter(([, type]) => type === 'focus')
    .map(([node]) => node);
}

function isTitle(node: unknown): boolean {
  return (node as { props?: { children?: unknown } } | null)?.props?.children === TITLE;
}

function screen(open: boolean, onClose = jest.fn(), opener = createRef<View>()) {
  return (
    <>
      <View ref={opener} testID="opener" />
      <Dialog
        open={open}
        onClose={onClose}
        title={TITLE}
        description="Backers who chose it keep their pledge."
        returnFocusTo={opener}
        testID="dialog"
        footer={
          <>
            <Pill label="Delete" variant="danger" fullWidth onPress={() => {}} />
            <Pill label="Keep it" variant="ghost" fullWidth onPress={onClose} />
          </>
        }
      >
        <Body>It has no pledges yet.</Body>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing while closed', async () => {
    const { queryByText } = await renderEn(screen(false));
    expect(queryByText(TITLE)).toBeNull();
  });

  it('shows its title as a header, and its description', async () => {
    const { getByRole, getByText } = await renderEn(screen(true));
    expect(getByRole('header', { name: TITLE })).toBeTruthy();
    expect(getByText('Backers who chose it keep their pledge.')).toBeTruthy();
  });

  it('moves screen-reader focus to the title when it opens', async () => {
    await renderEn(screen(true));
    await waitFor(() => expect(focusTargets().some(isTitle)).toBe(true));
  });

  it('gives focus back to the control that opened it when it closes', async () => {
    const opener = createRef<View>();
    const onClose = jest.fn();
    const tree = await renderEn(screen(true, onClose, opener));
    await waitFor(() => expect(focusTargets().some(isTitle)).toBe(true));

    await tree.rerender(screen(false, onClose, opener));
    // Compared by identity and asserted as a boolean: a failing `toBe` would print the whole
    // component instance, which is large enough to exhaust the heap.
    await waitFor(() => expect(focusTargets().at(-1) === opener.current).toBe(true));
    expect(opener.current).not.toBeNull();
  });

  it('closes on Android back — the Modal’s onRequestClose', async () => {
    const onClose = jest.fn();
    const { container } = await renderEn(screen(true, onClose));
    const [modal] = container.queryAll((node) => node.type === 'Modal');
    expect(modal).toBeDefined();
    modal?.props.onRequestClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the iOS escape gesture, and is modal to VoiceOver', async () => {
    const onClose = jest.fn();
    const { getByTestId } = await renderEn(screen(true, onClose));
    const panel = getByTestId('dialog');
    expect(panel.props.accessibilityViewIsModal).toBe(true);
    await fireEvent(panel, 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from its X, named from the catalogue', async () => {
    const onClose = jest.fn();
    const { getByRole } = await renderEn(screen(true, onClose));
    await fireEvent.press(getByRole('button', { name: en.mobile.kitForm.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is a white panel, radius 28, with the float shadow, over a black/64 scrim', async () => {
    const { getByTestId, container } = await renderEn(screen(true));
    expect(StyleSheet.flatten(getByTestId('dialog').props.style)).toMatchObject({
      backgroundColor: colors.whiteSurface,
      borderRadius: radius.xl,
      boxShadow: shadow.float,
    });
    const scrims = container.queryAll(
      (node) =>
        node.type === 'View' &&
        StyleSheet.flatten(node.props.style)?.backgroundColor === tint(colors.black, 0.64),
    );
    expect(scrims).toHaveLength(1);
    // The scrim is not a stop for a screen reader: the X and the buttons are the ways out.
    expect(scrims[0]?.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('switches the text inside it to on-white tones', async () => {
    const { getByText } = await renderEn(screen(true));
    expect(StyleSheet.flatten(getByText('It has no pledges yet.').props.style).color).toBe(
      TONES.white.secondary,
    );
    expect(StyleSheet.flatten(getByText(TITLE).props.style).color).toBe(colors.textOnWhite);
  });

  it('stacks its buttons, primary first', async () => {
    const { getAllByRole } = await renderEn(screen(true));
    const names = getAllByRole('button').map((button) => button.props.accessibilityLabel);
    expect(names.indexOf('Delete')).toBeLessThan(names.indexOf('Keep it'));
  });

  it('avoids the keyboard on iOS, and lets a tap reach a button under an open keyboard', async () => {
    // A class component with no host of its own that keeps the prop, so its render is watched.
    const avoiding = jest.spyOn(KeyboardAvoidingView.prototype, 'render');
    const { getByText } = await renderEn(screen(true));
    const [instance] = avoiding.mock.contexts as { props: { behavior?: string } }[];
    expect(instance?.props.behavior).toBe('padding');
    avoiding.mockRestore();
    let node = getByText('It has no pledges yet.').parent;
    while (node !== null && node.props.keyboardShouldPersistTaps === undefined) node = node.parent;
    expect(node?.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('hands the Modal its onDismiss, for what must open only after it has gone', async () => {
    const onDismiss = jest.fn();
    const { container } = await renderEn(
      <Dialog open onClose={() => {}} title={TITLE} onDismiss={onDismiss} />,
    );
    container.queryAll((node) => node.type === 'Modal')[0]?.props.onDismiss();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('enters without animation under a budget of none', async () => {
    const { getByTestId } = await renderEn(
      <MotionBudgetProvider level="none">{screen(true)}</MotionBudgetProvider>,
    );
    const style = StyleSheet.flatten(getByTestId('dialog').props.style);
    expect(style.opacity).toBeUndefined();
    expect(style.transform).toBeUndefined();
  });

  it('enters on a spring — opacity, a 24pt rise and a scale from 0.96, transform and opacity only', async () => {
    const { getByTestId } = await renderEn(
      <MotionBudgetProvider level="full">{screen(true)}</MotionBudgetProvider>,
    );
    const panel = getByTestId('dialog');
    // The first frame: away, small and clear.
    const first = StyleSheet.flatten(panel.props.style);
    expect(first.opacity).toBe(0);
    expect(DIALOG_RISE).toBe(24);
    expect(first.transform).toEqual([{ translateY: DIALOG_RISE }, { scale: DIALOG_ENTRY_SCALE }]);
    // Then it settles, with nothing but transform and opacity animated.
    await waitFor(
      () => {
        const now = getAnimatedStyle(panel as never) as {
          opacity?: number;
          transform?: [{ translateY: number }, { scale: number }];
        };
        expect(now.opacity).toBeCloseTo(1, 2);
        expect(now.transform?.[0].translateY).toBeCloseTo(0, 1);
        expect(now.transform?.[1].scale).toBeCloseTo(1, 2);
      },
      { timeout: 3000 },
    );
  });

  it('fades its scrim in with it', async () => {
    const { getByTestId } = await renderEn(screen(true));
    const scrim = getByTestId('dialog-scrim', { includeHiddenElements: true }).parent as never;
    await waitFor(
      () => expect((getAnimatedStyle(scrim) as { opacity?: number }).opacity).toBeCloseTo(1, 2),
      { timeout: 3000 },
    );
  });

  it('goes on a spring: out of reach and unheard at once, then gone and reported', async () => {
    const onDismiss = jest.fn();
    const ui = (open: boolean) => (
      <Dialog open={open} onClose={jest.fn()} onDismiss={onDismiss} title={TITLE} testID="dialog">
        <Text>Body</Text>
      </Dialog>
    );
    const view = await renderEn(ui(true));
    await view.rerender(ui(false));

    const panel = view.queryByTestId('dialog', { includeHiddenElements: true });
    if (panel !== null) {
      expect(panel.props.pointerEvents).toBe('none');
      expect(panel.props.accessibilityElementsHidden).toBe(true);
    }
    expect(view.queryByRole('header', { name: TITLE })).toBeNull();
    await waitFor(
      () => expect(view.queryByText('Body', { includeHiddenElements: true })).toBeNull(),
      { timeout: 3000 },
    );
  });

  it('goes at once under a budget of none', async () => {
    const ui = (open: boolean) => (
      <MotionBudgetProvider level="none">
        <Dialog open={open} onClose={jest.fn()} title={TITLE}>
          <Text>Body</Text>
        </Dialog>
      </MotionBudgetProvider>
    );
    const view = await renderEn(ui(true));
    await view.rerender(ui(false));
    expect(view.queryByText('Body', { includeHiddenElements: true })).toBeNull();
  });

  it('appears and goes at once, with no animated style, when Reduce Motion is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const ui = (open: boolean) => (
      <Dialog open={open} onClose={jest.fn()} title={TITLE} testID="dialog">
        <Text>Body</Text>
      </Dialog>
    );
    const view = await renderEn(ui(false));
    await view.rerender(ui(true));
    await waitFor(() => {
      const style = StyleSheet.flatten(view.getByTestId('dialog').props.style);
      expect(style.opacity).toBeUndefined();
      expect(style.transform).toBeUndefined();
    });
    await view.rerender(ui(false));
    expect(view.queryByText('Body', { includeHiddenElements: true })).toBeNull();
  });

  it('scales the page behind under a SheetHost, as a sheet does, and lets it go on close', async () => {
    const ui = (open: boolean) => (
      <SheetHost>
        <View testID="page" />
        <Dialog open={open} onClose={jest.fn()} title={TITLE} />
      </SheetHost>
    );
    const view = await renderEn(ui(true));
    const scale = () =>
      (getAnimatedStyle(view.getByTestId('page').parent as never) as { transform?: { scale: number }[] })
        .transform?.[0]?.scale;
    await waitFor(() => expect(scale()).toBeCloseTo(SHEET_PAGE_SCALE, 2), { timeout: 3000 });
    await view.rerender(ui(false));
    await waitFor(() => expect(scale()).toBeCloseTo(1, 2), { timeout: 3000 });
  });
});

function _typeChecks() {
  // @ts-expect-error — a dialog without a title has nothing to be announced as.
  void (<Dialog open onClose={() => {}} />);
}
void _typeChecks;
