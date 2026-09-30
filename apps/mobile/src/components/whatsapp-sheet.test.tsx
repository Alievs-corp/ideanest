import type { ReactElement } from 'react';
import { AccessibilityInfo, Linking, TextInput } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { MESSAGE_MAX_LENGTH, whatsappHref, type Locale } from '@ideanest/messages';
import { FailureState } from './failure-state';
import { WhatsAppSheet } from './whatsapp-sheet';

/**
 * The WhatsApp sheet — issue #150: the web's rule, the web's link, and errors a screen reader
 * hears.
 *
 * <p>`missingFields` and `whatsappHref` are tested where they live, in `@ideanest/messages`.
 * This is the part only the app has: which field receives focus, what is announced, and that
 * the link handed to the phone is the shared one.
 */

/** A phone with a notch and a home indicator, so the sheet has real insets to read. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const copy = en.shell.whatsapp;

/*
 * React Native's jest preset gives every `TextInput` one shared `focus` mock on the prototype,
 * so WHICH field was focused is the `this` of the call — the instance, whose props carry the
 * label the reader hears.
 */
const focus = TextInput.prototype.focus as unknown as jest.Mock;
function lastFocusedLabel(): unknown {
  const instance = focus.mock.contexts.at(-1) as
    | { props: { accessibilityLabel?: string } }
    | undefined;
  return instance?.props.accessibilityLabel;
}

function inEnglish(ui: ReactElement) {
  return inLocale('en', en, ui);
}

function inLocale(locale: Locale, messages: typeof en, ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale={locale} messages={messages}>
        {ui}
      </IntlProvider>
    </SafeAreaProvider>,
  );
}

/*
 * The sheet's first render also pays for loading the kit's module graph, which has taken past
 * jest's 5 s default on a cold run, as the Me tab's suite notes too.
 */
jest.setTimeout(20_000);

beforeEach(() => {
  focus.mockClear();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockClear();
  jest.spyOn(Linking, 'openURL').mockReset().mockResolvedValue(true);
});

describe('WhatsAppSheet', () => {
  it('refuses an empty form, announces the first error and moves focus to its field', async () => {
    await inEnglish(<WhatsAppSheet visible onClose={jest.fn()} />);

    await fireEvent.press(screen.getByRole('button', { name: copy.submit }));

    expect(screen.getByText(copy.errors.firstName)).toBeTruthy();
    expect(screen.getByText(copy.errors.lastName)).toBeTruthy();
    expect(screen.getByText(copy.errors.message)).toBeTruthy();
    expect(lastFocusedLabel()).toBe(copy.fields.firstName);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(copy.errors.firstName);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('moves to the first field that is STILL empty, not the first field', async () => {
    await inEnglish(<WhatsAppSheet visible onClose={jest.fn()} />);

    await fireEvent.changeText(screen.getByLabelText(copy.fields.firstName), 'Aysel');
    await fireEvent.press(screen.getByRole('button', { name: copy.submit }));

    expect(screen.queryByText(copy.errors.firstName)).toBeNull();
    expect(lastFocusedLabel()).toBe(copy.fields.lastName);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith(
      copy.errors.lastName,
    );
  });

  it('treats a field of spaces as empty, as the shared rule does', async () => {
    await inEnglish(<WhatsAppSheet visible onClose={jest.fn()} />);

    await fireEvent.changeText(screen.getByLabelText(copy.fields.firstName), 'Aysel');
    await fireEvent.changeText(screen.getByLabelText(copy.fields.lastName), 'Məmmədova');
    await fireEvent.changeText(screen.getByLabelText(copy.fields.message), '   ');
    await fireEvent.press(screen.getByRole('button', { name: copy.submit }));

    expect(lastFocusedLabel()).toBe(copy.fields.message);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('hands the shared link to the phone, then says WhatsApp is open — never "sent"', async () => {
    await inEnglish(<WhatsAppSheet visible onClose={jest.fn()} />);
    const enquiry = { firstName: 'Aysel', lastName: 'Məmmədova', message: 'Salam!\nİki sual.' };

    await fireEvent.changeText(screen.getByLabelText(copy.fields.firstName), enquiry.firstName);
    await fireEvent.changeText(screen.getByLabelText(copy.fields.lastName), enquiry.lastName);
    await fireEvent.changeText(screen.getByLabelText(copy.fields.message), enquiry.message);
    await fireEvent.press(screen.getByRole('button', { name: copy.submit }));

    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenCalledWith(whatsappHref(enquiry));
    expect(screen.getByText(copy.handoff.title)).toBeTruthy();
    expect(screen.getByText(copy.handoff.detail)).toBeTruthy();

    // The way through for a phone where the first hand-off went nowhere.
    await fireEvent.press(screen.getByRole('button', { name: copy.handoff.again }));
    expect(Linking.openURL).toHaveBeenCalledTimes(2);
    expect(Linking.openURL).toHaveBeenLastCalledWith(whatsappHref(enquiry));
  });

  it('caps the message and says how much room is left', async () => {
    await inEnglish(<WhatsAppSheet visible onClose={jest.fn()} />);

    const field = screen.getByLabelText(copy.fields.message);
    expect(field.props.maxLength).toBe(MESSAGE_MAX_LENGTH);
    expect(screen.getByText(`${MESSAGE_MAX_LENGTH} characters remaining`)).toBeTruthy();

    await fireEvent.changeText(field, 'x'.repeat(MESSAGE_MAX_LENGTH - 1));
    expect(screen.getByText('1 character remaining')).toBeTruthy();
  });

  it.each([
    [1, 'Остался 1 символ'],
    [2, 'Осталось 2 символа'],
    [5, 'Осталось 5 символов'],
    [21, 'Остался 21 символ'],
  ])('counts what is left in Russian plural forms (%i)', async (left, expected) => {
    await inLocale('ru', ru as typeof en, <WhatsAppSheet visible onClose={jest.fn()} />);

    await fireEvent.changeText(
      screen.getByLabelText(ru.shell.whatsapp.fields.message),
      'x'.repeat(MESSAGE_MAX_LENGTH - left),
    );
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('counts what is left in Turkish, which has one form', async () => {
    await inLocale('tr', tr as typeof en, <WhatsAppSheet visible onClose={jest.fn()} />);

    await fireEvent.changeText(
      screen.getByLabelText(tr.shell.whatsapp.fields.message),
      'x'.repeat(MESSAGE_MAX_LENGTH - 2),
    );
    expect(screen.getByText('2 karakter kaldı')).toBeTruthy();
  });

  it("closes on Android's back button and keeps what was typed", async () => {
    const onClose = jest.fn();
    const { container } = await inEnglish(<WhatsAppSheet visible onClose={onClose} />);

    await fireEvent.changeText(screen.getByLabelText(copy.fields.message), 'Salam');
    await fireEvent.press(screen.getByRole('button', { name: copy.submit }));
    // Android's back button is the Modal's `onRequestClose`, which the kit's `Sheet` owns.
    await act(async () => {
      container.queryAll((node) => node.type === 'Modal')[0]?.props.onRequestClose();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(copy.errors.firstName)).toBeNull();
    expect(screen.getByLabelText(copy.fields.message).props.value).toBe('Salam');
  });

  it('keeps what was typed when it is closed, and forgets the refusals', async () => {
    const onClose = jest.fn();
    await inEnglish(<WhatsAppSheet visible onClose={onClose} />);

    await fireEvent.changeText(screen.getByLabelText(copy.fields.firstName), 'Aysel');
    await fireEvent.press(screen.getByRole('button', { name: copy.submit }));
    await fireEvent.press(screen.getByRole('button', { name: copy.cancel }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(copy.errors.lastName)).toBeNull();
    expect(screen.getByLabelText(copy.fields.firstName).props.value).toBe('Aysel');
  });
});

describe('FailureState', () => {
  it('offers WhatsApp under the way out, and opens the same sheet', async () => {
    const notFound = en.shell.failure.pages.notFound;
    await inEnglish(
      <FailureState
        title={notFound.title}
        description={notFound.description}
        actionLabel={notFound.action}
        onAction={jest.fn()}
      />,
    );

    expect(screen.queryByText(copy.title)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.open }));
    expect(screen.getByText(copy.title)).toBeTruthy();
  });
});
