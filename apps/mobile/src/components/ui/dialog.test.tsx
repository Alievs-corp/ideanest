import { createRef, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors, radius, shadow, tint } from '../../theme';
import { Body } from '../text';
import { Dialog } from './dialog';
import { MotionBudgetProvider } from './motion-budget';
import { Pill } from './pill';
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

  it('enters with opacity and a 24pt rise where motion is allowed — transform and opacity only', async () => {
    const { getByTestId } = await renderEn(
      <MotionBudgetProvider level="full">{screen(true)}</MotionBudgetProvider>,
    );
    const style = StyleSheet.flatten(getByTestId('dialog').props.style);
    expect(style.opacity).toBe(0);
    expect(style.transform).toEqual([{ translateY: 24 }]);
  });
});

function _typeChecks() {
  // @ts-expect-error — a dialog without a title has nothing to be announced as.
  void (<Dialog open onClose={() => {}} />);
}
void _typeChecks;
