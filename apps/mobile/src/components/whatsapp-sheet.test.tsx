import type { ReactElement } from 'react';
import { AccessibilityInfo, Linking, TextInput } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { MESSAGE_MAX_LENGTH, whatsappHref } from '@ideanest/messages';
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
  return render(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

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
