import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../lib/locale';
import { DeleteDialog } from './delete-dialog';
import { EditorModal } from './editor-modal';

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function showModal({ dirty = false, saving = false } = {}) {
  const onClose = jest.fn();
  const onSave = jest.fn();
  await act(async () => setLocale('en'));
  view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        <EditorModal visible title="Edit item" dirty={dirty} saving={saving} onSave={onSave} onClose={onClose}>
          <Text>form</Text>
        </EditorModal>
      </IntlProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return { onClose, onSave };
}

let view: Awaited<ReturnType<typeof render>>;
/** The native modals, outermost first: the editor's own, then the discard dialog's. */
const modals = () => view.container.queryAll((node) => node.type === 'Modal');
const sheet = () => modals()[0];
const DRAWER = en.campaignEditor.drawer;
const DISCARD = en.mobile.editor.discard;

describe('EditorModal', () => {
  it('has Cancel and Save in its header, and saves on Save', async () => {
    const { onSave } = await showModal();
    expect(screen.getByRole('header', { name: 'Edit item' })).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(DRAWER.save));
    expect(onSave).toHaveBeenCalled();
  });

  it('closes at once when nothing would be lost, by Cancel or by a swipe', async () => {
    const { onClose } = await showModal();
    expect(sheet()?.props.allowSwipeDismissal).toBe(true);
    await fireEvent.press(screen.getByLabelText(DRAWER.cancel));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => sheet()?.props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('dirty, refuses the swipe and asks "Discard changes?" before closing', async () => {
    const { onClose } = await showModal({ dirty: true });
    expect(sheet()?.props.allowSwipeDismissal).toBe(false);

    await fireEvent.press(screen.getByLabelText(DRAWER.cancel));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(DISCARD.title)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(DISCARD.keep));
    await settle();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => sheet()?.props.onRequestClose());
    await settle();
    await fireEvent.press(screen.getByLabelText(DISCARD.confirm));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('while saving, nothing closes it: Cancel is disabled, back and the swipe do nothing', async () => {
    const { onClose, onSave } = await showModal({ dirty: true, saving: true });
    expect(sheet()?.props.allowSwipeDismissal).toBe(false);
    expect(screen.getByLabelText(DRAWER.cancel).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByLabelText(DRAWER.saving).props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => sheet()?.props.onRequestClose());
    await settle();
    expect(screen.queryByText(DISCARD.title)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('DeleteDialog', () => {
  async function showDialog(deleting = false) {
    const onDelete = jest.fn();
    const onKeep = jest.fn();
    view = await render(
      <IntlProvider locale="en" messages={en}>
        <DeleteDialog
          open
          title="Delete Mug?"
          description={en.campaignEditor.rewards.cannotBeUndone}
          deleteLabel={en.campaignEditor.rewards.delete}
          keepLabel={en.campaignEditor.rewards.keepIt}
          deleting={deleting}
          onDelete={onDelete}
          onKeep={onKeep}
          testID="delete"
        />
      </IntlProvider>,
    );
    await settle();
    return { onDelete, onKeep };
  }

  it('asks with the caller’s words and deletes on Delete', async () => {
    const { onDelete, onKeep } = await showDialog();
    expect(screen.getByText('Delete Mug?')).toBeTruthy();
    expect(screen.getByText(en.campaignEditor.rewards.cannotBeUndone)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.campaignEditor.rewards.delete));
    expect(onDelete).toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(en.campaignEditor.rewards.keepIt));
    expect(onKeep).toHaveBeenCalled();
  });

  it('is not closed by the backdrop and has no corner X', async () => {
    const { onKeep } = await showDialog();
    await fireEvent.press(screen.getByTestId('delete-scrim', { includeHiddenElements: true }));
    expect(onKeep).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(en.mobile.kitForm.close)).toBeNull();
  });

  it('while deleting, keeps both buttons from a second press', async () => {
    const { onKeep } = await showDialog(true);
    expect(screen.getByTestId('delete-delete').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('delete-keep').props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => modals()[0]?.props.onRequestClose());
    expect(onKeep).not.toHaveBeenCalled();
  });
});
