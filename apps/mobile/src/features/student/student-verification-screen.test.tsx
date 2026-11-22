import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as ImagePicker from 'expo-image-picker';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import * as client from '../../api/client';
import * as upload from '../../lib/media/upload';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { StudentVerificationScreen } from './student-verification-screen';

/**
 * `settings/student` (#655): the status in each state, the form while a submission is accepted,
 * the photographs (the card from the library or camera, the selfie from the front camera), the
 * local size ceiling, the multipart body, and the refusals by code and field.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../api/client', () => ({ readJson: jest.fn(), sendMultipart: jest.fn() }));
jest.mock('../../lib/media/upload', () => ({
  ...jest.requireActual('../../lib/media/upload'),
  prepareJpeg: jest.fn(),
  forgetPicked: jest.fn(),
}));

jest.setTimeout(30_000);

const readJson = jest.mocked(client.readJson);
const sendMultipart = jest.mocked(client.sendMultipart);
const prepareJpeg = jest.mocked(upload.prepareJpeg);
const forgetPicked = jest.mocked(upload.forgetPicked);
const picker = ImagePicker as unknown as typeof ImagePicker & {
  __setNextResult: (result: Record<string, unknown>) => void;
  __reset: () => void;
};

const S = en.mobile.studentVerification;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let current: unknown;

/** Text content that includes `text`, wherever it sits among the rest. */
function contains(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/*
 * React Native's own `FormData`, which takes a file as `{ uri, name, type }` and is what the app
 * sends on a device. Jest's environment has Node's, which would turn that part into a string.
 */
const NodeFormData = global.FormData;
beforeAll(() => {
  global.FormData = jest.requireActual('react-native/Libraries/Network/FormData').default;
});
afterAll(() => {
  global.FormData = NodeFormData;
});

let queryClient: QueryClient | undefined;
afterEach(() => queryClient?.clear());

async function show() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          <StudentVerificationScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

function refusal(status: number, code: string, field?: string): ApiError {
  return new ApiError(status, { title: 'Refused', status, code, ...(field === undefined ? {} : { field }) } as never);
}

/** The next picker answer: one photograph at `uri`. */
function picks(uri: string) {
  picker.__setNextResult({ canceled: false, assets: [{ uri, width: 3000, height: 2000 }] });
}

async function press(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await settle();
}

async function fillForm() {
  await fireEvent.changeText(screen.getByTestId('student-institution-input'), ' ADA University ');
  await fireEvent.changeText(screen.getByTestId('student-card-number-input'), 'ab 123456');
  picks('file:///cache/picked-card.jpg');
  await press('student-studentCard-library');
  picks('file:///cache/picked-selfie.jpg');
  await press('student-selfie-camera');
}

/** A `FormData`'s parts by name — React Native's (`getParts`) or the standard one (`get`). */
function partsOf(form: FormData): Record<string, unknown> {
  const native = form as unknown as { getParts?: () => { fieldName: string; string?: string; uri?: string; name?: string; type?: string }[] };
  if (typeof native.getParts === 'function') {
    return Object.fromEntries(
      native.getParts().map((part) => [part.fieldName, part.string ?? { uri: part.uri, name: part.name, type: part.type }]),
    );
  }
  return Object.fromEntries(['institution', 'cardNumber', 'studentCard', 'selfie'].map((name) => [name, form.get(name)]));
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  picker.__reset();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
  current = { state: 'NONE' };
  readJson.mockImplementation(async () => current);
  prepareJpeg.mockImplementation(async (uri: string) => ({ uri: `${uri}.prepared.jpg`, byteSize: 900_000 }));
});

describe('the status', () => {
  it('reads the check from the service', async () => {
    await show();
    expect(readJson).toHaveBeenCalledWith('/v1/me/student-verification', expect.anything());
    expect(screen.getByTestId('student-state-NONE')).toHaveTextContent(contains(S.status.NONE));
  });

  it('while pending: the institution, the masked number, when it was sent, and no form', async () => {
    current = {
      state: 'PENDING',
      institution: 'ADA University',
      cardNumber: 'AB123456',
      submittedAt: '2026-11-20T09:00:00Z',
    };
    await show();
    expect(screen.getByTestId('student-state-PENDING')).toHaveTextContent(contains(S.status.PENDING));
    expect(screen.getByTestId('student-institution')).toHaveTextContent(contains('ADA University'));
    expect(screen.getByTestId('student-card-number')).toHaveTextContent(contains('•••• 3456'));
    expect(screen.getByTestId('student-card-number')).not.toHaveTextContent(/AB12/);
    expect(screen.getByTestId('student-submitted-at')).toHaveTextContent(/20 November 2026/);
    expect(screen.queryByTestId('student-form')).toBeNull();
  });

  it('once approved: until when, the way to the plans, and no form', async () => {
    current = { state: 'APPROVED', institution: 'BDU', cardNumber: '99887766', validUntil: '2027-11-22T10:00:00Z' };
    await show();
    expect(screen.getByTestId('student-state-APPROVED')).toHaveTextContent(/confirmed until 22 November 2027/);
    expect(screen.getByTestId('student-valid-until')).toHaveTextContent(/22 November 2027/);
    expect(screen.queryByTestId('student-form')).toBeNull();
    await press('student-to-pricing');
    expect(mockRouter.push).toHaveBeenCalledWith('/pricing');
  });

  it('when refused: staff reason, and the form to send again', async () => {
    current = { state: 'REJECTED', institution: 'BDU', cardNumber: '99887766', rejectionReason: 'The photo is blurred.' };
    await show();
    expect(screen.getByTestId('student-state-REJECTED')).toHaveTextContent(/Reason: The photo is blurred\./);
    expect(screen.getByTestId('student-form')).toBeTruthy();
  });

  it('when expired: the date it ended, and the form', async () => {
    current = { state: 'EXPIRED', validUntil: '2026-11-01T00:00:00Z' };
    await show();
    expect(screen.getByTestId('student-state-EXPIRED')).toHaveTextContent(/ended on 1 November 2026/);
    expect(screen.getByTestId('student-form')).toBeTruthy();
  });

  it('says when it cannot read the check, and tries again in place', async () => {
    readJson.mockRejectedValueOnce(new ApiError(500));
    await show();
    expect(screen.getByTestId('student-unavailable')).toHaveTextContent(contains(S.unavailable));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain })));
    await settle();
    expect(screen.getByTestId('student-state-NONE')).toBeTruthy();
  });

  it('sends a signed-out reader to sign in and back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/settings/student' } });
    expect(readJson).not.toHaveBeenCalled();
  });
});

describe('the form', () => {
  it('says why it asks for a selfie, and that one card is one account', async () => {
    await show();
    expect(screen.getByTestId('student-selfie-field')).toHaveTextContent(contains(S.form.selfieWhy));
    expect(screen.getByTestId('student-form')).toHaveTextContent(contains(S.form.oneAccount));
  });

  it('sends nothing until every field is there, and says what is missing', async () => {
    await show();
    await press('student-submit');
    expect(sendMultipart).not.toHaveBeenCalled();
    const form = screen.getByTestId('student-form');
    expect(form).toHaveTextContent(contains(S.form.institutionRequired));
    expect(form).toHaveTextContent(contains(S.form.cardNumberInvalid));
    expect(form).toHaveTextContent(contains(S.form.cardPhotoRequired));
    expect(form).toHaveTextContent(contains(S.form.selfieRequired));
  });

  it('takes the selfie with the front camera, and the card without a crop', async () => {
    await show();
    await fillForm();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: 'images', allowsEditing: false }),
    );
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({ cameraType: 'front' }));
    expect(screen.getByTestId('student-studentCard-preview')).toBeTruthy();
    expect(screen.getByTestId('student-selfie-preview')).toBeTruthy();
    // The picker's copies are removed; the JPEGs made from them are kept to send.
    expect(forgetPicked).toHaveBeenCalledWith('file:///cache/picked-card.jpg');
    expect(forgetPicked).toHaveBeenCalledWith('file:///cache/picked-selfie.jpg');
  });

  it('sends the fields and both JPEGs as one multipart body, then shows the check as pending', async () => {
    sendMultipart.mockResolvedValueOnce({
      state: 'PENDING',
      institution: 'ADA University',
      cardNumber: 'AB123456',
      submittedAt: '2026-11-22T09:00:00Z',
    });
    await show();
    await fillForm();
    await press('student-submit');

    expect(sendMultipart).toHaveBeenCalledTimes(1);
    const [path, form] = sendMultipart.mock.calls[0]!;
    expect(path).toBe('/v1/me/student-verification');
    const parts = partsOf(form);
    expect(parts.institution).toBe('ADA University');
    expect(parts.cardNumber).toBe('ab 123456');
    expect(parts.studentCard).toEqual(
      expect.objectContaining({ uri: 'file:///cache/picked-card.jpg.prepared.jpg', type: 'image/jpeg' }),
    );
    expect(parts.selfie).toEqual(
      expect.objectContaining({ uri: 'file:///cache/picked-selfie.jpg.prepared.jpg', type: 'image/jpeg' }),
    );

    expect(screen.getByTestId('student-sent')).toHaveTextContent(contains(S.form.sent));
    expect(screen.getByTestId('student-state-PENDING')).toBeTruthy();
    expect(screen.queryByTestId('student-form')).toBeNull();
    expect(forgetPicked).toHaveBeenCalledWith('file:///cache/picked-card.jpg.prepared.jpg');
    expect(forgetPicked).toHaveBeenCalledWith('file:///cache/picked-selfie.jpg.prepared.jpg');
  });

  it('says a card used by another account', async () => {
    sendMultipart.mockRejectedValueOnce(refusal(409, 'STUDENT_CARD_IN_USE'));
    await show();
    await fillForm();
    await press('student-submit');
    expect(screen.getByTestId('student-refusal')).toHaveTextContent(contains(S.errors.cardInUse));
  });

  it('puts a document refusal on the photograph it is about', async () => {
    sendMultipart.mockRejectedValueOnce(refusal(400, 'UNSUPPORTED_TYPE', 'selfie'));
    await show();
    await fillForm();
    await press('student-submit');
    expect(screen.getByTestId('student-selfie-field')).toHaveTextContent(contains(S.errors.unsupportedFile));
    expect(screen.getByTestId('student-studentCard-field')).not.toHaveTextContent(contains(S.errors.unsupportedFile));
  });

  it('re-reads the check when the service says one is already sent', async () => {
    sendMultipart.mockRejectedValueOnce(refusal(409, 'STUDENT_VERIFICATION_ALREADY_SUBMITTED'));
    await show();
    await fillForm();
    current = { state: 'PENDING' };
    await press('student-submit');
    expect(readJson).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('student-state-PENDING')).toBeTruthy();
  });

  it('scales a large photograph down, and refuses one that never fits five megabytes', async () => {
    prepareJpeg.mockImplementation(async (uri: string, options) => ({
      uri: `${uri}.${options.maxEdge}.jpg`,
      byteSize: 6 * 1024 * 1024,
    }));
    await show();
    picks('file:///cache/huge.jpg');
    await press('student-studentCard-library');

    expect(prepareJpeg.mock.calls.map(([, options]) => options.maxEdge)).toEqual([2048, 1600, 1280]);
    // Every attempt's file is removed, and the picker's copy too.
    expect(forgetPicked).toHaveBeenCalledWith('file:///cache/huge.jpg.2048.jpg');
    expect(forgetPicked).toHaveBeenCalledWith('file:///cache/huge.jpg.1280.jpg');
    expect(forgetPicked).toHaveBeenCalledWith('file:///cache/huge.jpg');
    expect(screen.getByTestId('student-studentCard-field')).toHaveTextContent(contains(en.mobile.kitForm.filePicker.tooLarge.replace('{megabytes}', '5')));
    expect(screen.queryByTestId('student-studentCard-preview')).toBeNull();
  });

  it('keeps the second attempt when it fits', async () => {
    prepareJpeg.mockImplementation(async (uri: string, options) => ({
      uri: `${uri}.${options.maxEdge}.jpg`,
      byteSize: options.maxEdge === 2048 ? 6 * 1024 * 1024 : 3 * 1024 * 1024,
    }));
    await show();
    picks('file:///cache/big.jpg');
    await press('student-studentCard-library');
    expect(prepareJpeg).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('student-studentCard-preview').props.source).toEqual({ uri: 'file:///cache/big.jpg.1600.jpg' });
  });

  it('says when the camera may not be used', async () => {
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as never);
    await show();
    await press('student-selfie-camera');
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('student-selfie-field')).toHaveTextContent(contains(en.mobile.kitForm.filePicker.cameraDenied));
  });

  it('sends nothing offline', async () => {
    await show();
    await fillForm();
    await act(async () => setOnline(false));
    await press('student-submit');
    expect(sendMultipart).not.toHaveBeenCalled();
  });
});
