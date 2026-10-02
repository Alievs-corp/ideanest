import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as ImagePicker from 'expo-image-picker';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import * as client from '../../../api/client';
import { setOnline } from '../../../lib/connectivity';
import { translate } from '../../../lib/i18n';
import { setLocale } from '../../../lib/locale';
import { UploadFailed, uploadImage } from '../../../lib/media/upload';
import { describeUploadFailure } from './avatar-field';
import { ProfileSettingsScreen } from './profile-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockGet = jest.fn();
const mockPublicGet = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../../api/client', () => ({
  api: () => ({ get: mockGet }),
  publicApi: () => ({ get: mockPublicGet }),
  sendJson: jest.fn(),
}));
jest.mock('../../../lib/media/upload', () => ({
  ...jest.requireActual('../../../lib/media/upload'),
  uploadImage: jest.fn(),
}));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
const upload = jest.mocked(uploadImage);
const picker = ImagePicker as unknown as typeof ImagePicker & {
  __setNextResult: (result: Record<string, unknown>) => void;
  __reset: () => void;
};
const T = en.profile.editor;
const COVER = en.campaignEditor.cover;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const PROFILE = {
  name: 'Aysel Məmmədova',
  slug: 'aysel',
  bio: 'I make lamps.',
  avatarUrl: null,
  websiteUrl: 'https://aysel.example.com',
  location: { slug: 'baku', name: 'Bakı' },
  socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/aysel' }],
};
const LOCATIONS = {
  items: [
    { slug: 'baku', name: 'Bakı' },
    { slug: 'ganja', name: 'Gəncə' },
  ],
};

function refusal(status: number, code: string, detail: string, meta?: Record<string, unknown>) {
  return new ApiError(status, {
    type: 'about:blank',
    title: 'Refused',
    status,
    detail,
    code,
    ...(meta === undefined ? {} : { meta }),
  });
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let queryClient: QueryClient;

async function show() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          <ProfileSettingsScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  picker.__reset();
  mockSession = { signedIn: true, locked: false, unlocked: false };
  setOnline(true);
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/v1/me/profile') return PROFILE;
    throw new Error(`unexpected read ${path}`);
  });
  mockPublicGet.mockResolvedValue(LOCATIONS);
});

describe('states', () => {
  it('shows a labelled skeleton while the profile loads', async () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    await show();
    expect(screen.getByTestId('profile-loading').props.accessibilityLabel).toBe(T.loading);
    expect(screen.queryByTestId('profile-save')).toBeNull();
  });

  it('shows a failed load with a retry that recovers', async () => {
    mockGet.mockRejectedValueOnce(refusal(500, 'INTERNAL', 'Something broke on our side.'));
    await show();
    expect(screen.getByTestId('profile-load-failed')).toBeTruthy();
    expect(screen.getByText(T.loadFailedTitle)).toBeTruthy();
    expect(screen.getByText('Something broke on our side.')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('profile-name').props.value).toBe(PROFILE.name);
  });

  it('says nothing is cached when offline with no profile in memory', async () => {
    setOnline(false);
    mockGet.mockRejectedValue(new TypeError('Network request failed'));
    await show();
    expect(screen.getByTestId('profile-offline-empty')).toBeTruthy();
    expect(screen.getByTestId('settings-offline')).toBeTruthy();
  });

  it('turns read-only offline, with the notice, and sends nothing', async () => {
    await show();
    await act(async () => setOnline(false));
    expect(screen.getByTestId('settings-offline')).toBeTruthy();
    expect(screen.getByTestId('profile-name').props.editable).toBe(false);
    expect(screen.getByTestId('profile-save').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('avatar-library').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('profile-save'));
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('sends a signed-out reader to sign in, and back here after', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings/profile' },
    });
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });
});

describe('how you appear', () => {
  it('links the public profile in-app, says the handle is fixed, and links privacy', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('profile-public-link'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/u/[slug]', params: { slug: 'aysel' } });
    expect(screen.getByText('Your handle, @aysel, cannot be changed here.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('profile-privacy-link'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/privacy');
  });
});

describe('saving', () => {
  it('sends only the changed keys and renders from the response', async () => {
    sendJson.mockResolvedValueOnce({ ...PROFILE, name: 'Aysel M.', bio: null });
    const invalidate = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
    await show();

    await fireEvent.changeText(screen.getByTestId('profile-name'), '  Aysel M. ');
    await fireEvent.changeText(screen.getByTestId('profile-bio'), '');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/profile', { name: 'Aysel M.', bio: null });
    expect(screen.getByTestId('profile-name').props.value).toBe('Aysel M.');
    expect(screen.getByText(T.savedTitle)).toBeTruthy();
    expect(screen.getByText('It is live at /u/aysel.')).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
    invalidate.mockRestore();

    // Editing again withdraws the confirmation.
    await fireEvent.changeText(screen.getByTestId('profile-name'), 'Aysel');
    expect(screen.queryByTestId('profile-saved')).toBeNull();
  });

  it('puts PROFILE_FIELD_INVALID under the field meta.field names, with no banner', async () => {
    sendJson.mockRejectedValueOnce(
      refusal(400, 'PROFILE_FIELD_INVALID', 'A website has to start with https://.', {
        field: 'websiteUrl',
      }),
    );
    await show();
    await fireEvent.changeText(screen.getByTestId('profile-website'), 'http://aysel.example.com');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/profile', {
      websiteUrl: 'http://aysel.example.com',
    });
    expect(screen.getAllByText('A website has to start with https://.').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('profile-save-failed')).toBeNull();
    expect(screen.queryByTestId('profile-saved')).toBeNull();
  });

  it('shows any other failure above the form', async () => {
    sendJson.mockRejectedValueOnce(new TypeError('Network request failed'));
    await show();
    await fireEvent.changeText(screen.getByTestId('profile-name'), 'Aysel');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await settle();
    expect(screen.getByTestId('profile-save-failed')).toBeTruthy();
    expect(screen.getByText(T.unreachable)).toBeTruthy();
  });

  it('shows the character counts against 80 and 2000', async () => {
    await show();
    expect(screen.getByTestId('profile-name-count').props.children).toBe(
      `${80 - PROFILE.name.length} characters remaining`,
    );
    expect(screen.getByTestId('profile-bio-count').props.children).toBe(
      `${2000 - PROFILE.bio.length} characters remaining`,
    );
    await fireEvent.changeText(screen.getByTestId('profile-name'), 'x'.repeat(83));
    expect(screen.getByTestId('profile-name-count').props.children).toBe('3 characters too many');
  });
});

describe('location', () => {
  it('offers "Not saying" and the places, and saves a change', async () => {
    sendJson.mockResolvedValueOnce({ ...PROFILE, location: { slug: 'ganja', name: 'Gəncə' } });
    await show();
    expect(mockPublicGet).toHaveBeenCalledWith('/v1/locations', expect.anything());

    await fireEvent.press(screen.getByTestId('profile-location'));
    await settle();
    expect(screen.getByText(T.notSaying)).toBeTruthy();
    await fireEvent.press(screen.getByText('Gəncə'));
    await fireEvent.press(screen.getByTestId('profile-save'));
    await settle();
    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/profile', { locationSlug: 'ganja' });
  });

  it('explains when the places could not be read, keeping what the profile says', async () => {
    mockPublicGet.mockRejectedValue(refusal(503, 'UNAVAILABLE', 'Down.'));
    await show();
    expect(screen.queryByTestId('profile-location')).toBeNull();
    expect(screen.getByText(T.locationsUnavailableWithValue.replace('{place}', 'Bakı'))).toBeTruthy();
  });
});

describe('social links', () => {
  it('counts what is used, names each Remove, and stops adding at five', async () => {
    await show();
    expect(screen.getByText('1 of 5 used.')).toBeTruthy();
    expect(screen.getByLabelText('Remove the Instagram link')).toBeTruthy();

    for (let i = 0; i < 4; i += 1) await fireEvent.press(screen.getByTestId('social-link-add'));
    expect(screen.getByText(T.links.atCap.replaceAll('{max}', '5'))).toBeTruthy();
    expect(screen.getByTestId('social-link-add').props.accessibilityState.disabled).toBe(true);
    // Each new row opened on a platform nobody had: no duplicates.
    expect(screen.getByLabelText('Facebook address')).toBeTruthy();
    expect(screen.getByLabelText('X address')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Remove the Facebook link'));
    expect(screen.getByText('4 of 5 used.')).toBeTruthy();
  });

  it('sends the whole list when a link changed', async () => {
    sendJson.mockResolvedValueOnce(PROFILE);
    await show();
    await fireEvent.press(screen.getByTestId('social-link-add'));
    await fireEvent.changeText(screen.getByTestId('social-link-url-1'), 'https://facebook.com/aysel ');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await settle();
    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/profile', {
      socialLinks: [
        { platform: 'INSTAGRAM', url: 'https://instagram.com/aysel' },
        { platform: 'FACEBOOK', url: 'https://facebook.com/aysel' },
      ],
    });
  });
});

describe('profile picture', () => {
  const UPLOADED = {
    mediaId: 'media-1',
    url: 'https://media.example.com/media-1.webp',
    width: 1024,
    height: 1024,
    blurDataUrl: '',
  };

  it('shows the initials with a name while there is no picture', async () => {
    await show();
    expect(screen.getByTestId('avatar-preview-initials').props.accessibilityLabel).toBe(
      'Aysel Məmmədova, with no picture',
    );
    expect(screen.getByText(T.avatar.initials)).toBeTruthy();
  });

  it('picks from the library with a square crop, uploads, and saves avatarUrl at once', async () => {
    picker.__setNextResult({ canceled: false, assets: [{ uri: 'file:///picked/a.heic' }] });
    upload.mockImplementation(async (_uri, options) => {
      options?.onStage?.('uploading');
      return UPLOADED;
    });
    sendJson.mockResolvedValueOnce({ ...PROFILE, avatarUrl: UPLOADED.url });
    await show();
    await fireEvent.changeText(screen.getByTestId('profile-bio'), 'An unsaved edit.');

    await fireEvent.press(screen.getByTestId('avatar-library'));
    await settle();

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1] }),
    );
    expect(upload).toHaveBeenCalledWith('file:///picked/a.heic', expect.anything());
    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/profile', { avatarUrl: UPLOADED.url });
    expect(screen.getByTestId('avatar-saved')).toBeTruthy();
    expect(screen.getByTestId('avatar-preview-image', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(T.avatar.cropped)).toBeTruthy();
    // The rest of the draft is left as it was, and is not yet saved.
    expect(screen.getByTestId('profile-bio').props.value).toBe('An unsaved edit.');

    sendJson.mockResolvedValueOnce({ ...PROFILE, avatarUrl: UPLOADED.url, bio: 'An unsaved edit.' });
    await fireEvent.press(screen.getByTestId('profile-save'));
    await settle();
    expect(sendJson).toHaveBeenLastCalledWith('PATCH', '/v1/me/profile', { bio: 'An unsaved edit.' });
  });

  it('says why an upload failed, and saves nothing', async () => {
    picker.__setNextResult({ canceled: false, assets: [{ uri: 'file:///picked/a.jpg' }] });
    upload.mockRejectedValueOnce(new UploadFailed('UPLOADS_UNAVAILABLE'));
    await show();
    await fireEvent.press(screen.getByTestId('avatar-library'));
    await settle();
    expect(screen.getByText(COVER.notUsedTitle)).toBeTruthy();
    expect(screen.getByText(COVER.failures.UPLOADS_UNAVAILABLE)).toBeTruthy();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('puts a refused avatarUrl under the picture', async () => {
    picker.__setNextResult({ canceled: false, assets: [{ uri: 'file:///picked/a.jpg' }] });
    upload.mockResolvedValueOnce(UPLOADED);
    sendJson.mockRejectedValueOnce(
      refusal(400, 'PROFILE_FIELD_INVALID', 'A picture address has to start with https://.', {
        field: 'avatarUrl',
      }),
    );
    await show();
    await fireEvent.press(screen.getByTestId('avatar-library'));
    await settle();
    expect(screen.getAllByText('A picture address has to start with https://.').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('avatar-saved')).toBeNull();
  });

  it('explains a camera refused for good, and opens nothing', async () => {
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    await show();
    await fireEvent.press(screen.getByTestId('avatar-camera'));
    await settle();
    expect(screen.getByText(en.mobile.kitForm.filePicker.cameraDenied)).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('does nothing when the picker is cancelled', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('avatar-library'));
    await settle();
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps the image address as a fallback, saved with the form, and Remove clears it', async () => {
    sendJson.mockResolvedValueOnce({ ...PROFILE, avatarUrl: 'https://images.example.com/me.jpg' });
    await show();
    await fireEvent.press(screen.getByTestId('avatar-use-address'));
    await fireEvent.changeText(screen.getByTestId('avatar-address'), 'https://images.example.com/me.jpg');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await settle();
    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/profile', {
      avatarUrl: 'https://images.example.com/me.jpg',
    });

    sendJson.mockResolvedValueOnce({ ...PROFILE, avatarUrl: null });
    await fireEvent.press(screen.getByTestId('avatar-remove'));
    await fireEvent.press(screen.getByTestId('profile-save'));
    await settle();
    expect(sendJson).toHaveBeenLastCalledWith('PATCH', '/v1/me/profile', { avatarUrl: null });
  });
});

describe('upload failure messages', () => {
  // `translate()` is called inside each test: the locale is set to English in `beforeEach`.

  it.each([
    ['UNSUPPORTED_FORMAT', COVER.failures.UNSUPPORTED_FORMAT],
    ['TOO_LARGE', COVER.failures.TOO_LARGE],
    ['EMPTY', COVER.failures.EMPTY],
    ['UPLOADS_UNAVAILABLE', COVER.failures.UPLOADS_UNAVAILABLE],
    ['MEDIA_STORAGE_UNREACHABLE', COVER.failures.MEDIA_STORAGE_UNREACHABLE],
    ['UPLOAD_STILL_PROCESSING', COVER.failures.UPLOAD_STILL_PROCESSING],
  ])('%s has its own sentence', (code, sentence) => {
    expect(describeUploadFailure(new UploadFailed(code), translate())).toBe(sentence);
  });

  it('TOO_SMALL names the 320 pixel floor, not the cover minimum', () => {
    expect(describeUploadFailure(new UploadFailed('TOO_SMALL'), translate())).toBe(
      COVER.failures.TOO_SMALL.replace('{minimum}', '320×320'),
    );
  });

  it("falls back to the service's sentence, then to a generic one", () => {
    expect(describeUploadFailure(new UploadFailed('NEW_CODE', 'The service said so.'), translate())).toBe(
      'The service said so.',
    );
    expect(describeUploadFailure(new UploadFailed('NEW_CODE'), translate())).toBe(COVER.unusable);
    expect(describeUploadFailure(new Error('boom'), translate())).toBe(COVER.unusable);
  });
});
