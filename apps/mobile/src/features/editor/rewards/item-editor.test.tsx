import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import type { Item } from '@ideanest/campaign-editor/contract';
import { editorChromeCopyFrom, rewardsPanelCopyFrom } from '@ideanest/campaign-editor/copy';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../../lib/locale';
import { uploadImage } from '../../../lib/media/upload';
import { editorTranslators } from '../translator';
import { ItemEditor } from './item-editor';

const mockSend = jest.fn();
jest.mock('../../../api/client', () => ({
  api: () => ({ get: jest.fn() }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));
jest.mock('../../../lib/media/upload', () => {
  const actual = jest.requireActual('../../../lib/media/upload');
  return { ...actual, uploadImage: jest.fn() };
});

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const { t, counter } = editorTranslators('en');
const COPY = rewardsPanelCopyFrom(t, 'en', editorChromeCopyFrom(t, counter, 'en').characterCount);
const picker = ImagePicker as unknown as typeof ImagePicker & {
  __setNextResult: (result: Record<string, unknown>) => void;
  __reset: () => void;
};

const MUG: Item = {
  id: 'i-mug',
  projectId: 'p1',
  name: 'Enamel mug',
  description: null,
  imageUrl: null,
  weightGrams: 320,
  isDigital: false,
  sku: 'MUG-01',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(item: Item | null) {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        <ItemEditor visible projectId="p1" item={item} copy={COPY} readOnly={false} onClose={onClose} onSaved={onSaved} />
      </IntlProvider>
    </SafeAreaProvider>,
  );
  return { onSaved, onClose };
}

const save = async () => {
  await fireEvent.press(screen.getByTestId('item-editor-save'));
  await settle();
};

beforeEach(() => {
  mockSend.mockReset();
  jest.mocked(uploadImage).mockReset();
  picker.__reset();
});

describe('ItemEditor', () => {
  it('asks for a name only once Save has been pressed', async () => {
    await show(null);
    const required = en.campaignEditor.rewards.vocabulary.item.nameRequired;
    expect(screen.queryByText(required, { includeHiddenElements: true })).toBeNull();
    await save();
    expect(screen.getByText(required, { includeHiddenElements: true })).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('makes a file weightless: the switch clears the weight and disables the field', async () => {
    await show(MUG);
    expect(screen.getByTestId('item-weight').props.value).toBe('320');
    await fireEvent(screen.getByTestId('item-digital'), 'valueChange', true);
    expect(screen.getByTestId('item-weight').props.value).toBe('');
    expect(screen.getByTestId('item-weight').props.editable).toBe(false);
  });

  it('creates an item with an uploaded photo as its image', async () => {
    jest.mocked(uploadImage).mockResolvedValue({
      mediaId: 'm1',
      url: 'https://cdn.ideanest/m1.jpg',
      width: 800,
      height: 800,
      blurDataUrl: '',
    } as Awaited<ReturnType<typeof uploadImage>>);
    picker.__setNextResult({ canceled: false, assets: [{ uri: 'file:///mug.heic', mimeType: 'image/jpeg', fileSize: 1000 }] });
    mockSend.mockImplementation(async (_method: string, _path: string, body: Record<string, unknown>) => ({ ...MUG, ...body }));
    const { onSaved, onClose } = await show(null);

    await fireEvent.changeText(screen.getByTestId('item-name'), '  Poster  ');
    await fireEvent.press(screen.getByTestId('item-image-library'));
    await settle();
    expect(screen.getByTestId('item-image-preview', { includeHiddenElements: true })).toBeTruthy();
    await save();

    expect(mockSend.mock.calls).toEqual([
      [
        'POST',
        '/v1/projects/p1/items',
        { name: 'Poster', description: null, imageUrl: 'https://cdn.ideanest/m1.jpg', weightGrams: null, isDigital: false, sku: null },
      ],
    ]);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('sends only the changed field on an edit, and nothing when nothing changed', async () => {
    mockSend.mockImplementation(async () => ({ ...MUG, sku: 'MUG-02' }));
    const first = await show(MUG);
    await save();
    expect(mockSend).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('item-sku'), 'MUG-02');
    await save();
    expect(mockSend.mock.calls).toEqual([['PATCH', '/v1/items/i-mug', { sku: 'MUG-02' }]]);
  });
});
