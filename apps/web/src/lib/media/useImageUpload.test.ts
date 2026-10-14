import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { coverImageCopyFrom } from '@ideanest/campaign-editor/copy';
import { translatorFor } from '../../test-copy';
import { UploadFailed, uploadImage, type UploadedImage, type UploadOptions } from './upload';
import { describeUploadFailure, useImageUpload } from './useImageUpload';

/**
 * The upload every picture field shares — #271, #313.
 *
 * WHAT THESE COVER: that a refusal becomes a sentence from the catalogue rather than a code or
 * the service's log English, that the one template among the refusals is filled, and that a
 * second file abandons the first instead of racing it — the defect that would show one
 * picture's stage over another's, or save the older picture after the newer one.
 */

vi.mock('./upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./upload')>()),
  uploadImage: vi.fn(),
}));

const uploadMock = vi.mocked(uploadImage);
const COPY = coverImageCopyFrom(translatorFor('campaignEditor'));

const file = (name = 'photo.jpg') => new File(['bytes'], name, { type: 'image/jpeg' });

function image(url: string): UploadedImage {
  return { mediaId: 'm', url, width: 800, height: 600, blurDataUrl: '' };
}

afterEach(() => {
  cleanup();
  uploadMock.mockReset();
});

describe('describeUploadFailure', () => {
  it('says a known refusal in the catalogue’s words, with the service floor filled in', () => {
    expect(describeUploadFailure(new UploadFailed('TOO_SMALL', 'log'), COPY)).toBe(
      'That image is too small to display. Anything from 320×320 upwards reads well.',
    );
    expect(describeUploadFailure(new UploadFailed('EMPTY', 'log'), COPY)).toBe('That file is empty.');
  });

  it('passes on the service’s sentence for a code this build has never heard of', () => {
    expect(describeUploadFailure(new UploadFailed('NEW_RULE', 'A sentence from the service.'), COPY)).toBe(
      'A sentence from the service.',
    );
  });

  it('falls back to the field’s own sentence when there is nothing better to say', () => {
    // A proxy's bare 502: an unknown code and no message.
    expect(describeUploadFailure(new UploadFailed('NEW_RULE', ''), COPY)).toBe(COPY.unusable);
    // A dropped connection: the browser's message is English whatever the reader's language.
    expect(describeUploadFailure(new TypeError('Failed to fetch'), COPY)).toBe(COPY.unusable);
  });
});

describe('useImageUpload', () => {
  /** An upload this test finishes by hand, reporting its stages through what the hook passed. */
  function pending() {
    const calls: Array<{ options: UploadOptions; resolve: (value: UploadedImage) => void }> = [];
    uploadMock.mockImplementation(
      (_file, options = {}) =>
        new Promise<UploadedImage>((resolve, reject) => {
          calls.push({ options, resolve });
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    return calls;
  }

  it('reports the stage while it runs and clears it when the image is ready', async () => {
    const calls = pending();
    const { result } = renderHook(() => useImageUpload());

    let finished: Promise<UploadedImage | null> | undefined;
    act(() => {
      finished = result.current.upload(file());
    });
    expect(result.current.stage).toBe('preparing');

    act(() => calls[0]?.options.onStage?.('processing'));
    expect(result.current.stage).toBe('processing');

    await act(async () => calls[0]?.resolve(image('https://cdn.example.test/a.webp')));
    await expect(finished).resolves.toEqual(image('https://cdn.example.test/a.webp'));
    expect(result.current.stage).toBeNull();
  });

  it('abandons the first file when a second is chosen, and reports only the second', async () => {
    const calls = pending();
    const { result } = renderHook(() => useImageUpload());

    let first: Promise<UploadedImage | null> | undefined;
    let second: Promise<UploadedImage | null> | undefined;
    act(() => {
      first = result.current.upload(file('first.jpg'));
    });
    act(() => {
      second = result.current.upload(file('second.jpg'));
    });

    expect(calls[0]?.options.signal?.aborted).toBe(true);
    await expect(first).resolves.toBeNull();

    // The abandoned upload reporting on its way out does not overwrite the current stage.
    act(() => calls[0]?.options.onStage?.('processing'));
    act(() => calls[1]?.options.onStage?.('uploading'));
    expect(result.current.stage).toBe('uploading');

    await act(async () => calls[1]?.resolve(image('https://cdn.example.test/b.webp')));
    await expect(second).resolves.toEqual(image('https://cdn.example.test/b.webp'));
  });

  it('stops the transfer when the field leaves the page', () => {
    const calls = pending();
    const { result, unmount } = renderHook(() => useImageUpload());

    act(() => {
      void result.current.upload(file());
    });
    unmount();

    expect(calls[0]?.options.signal?.aborted).toBe(true);
  });

  it('passes a refusal on to the field to explain', async () => {
    uploadMock.mockRejectedValue(new UploadFailed('TOO_LARGE', 'log'));
    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await expect(result.current.upload(file())).rejects.toMatchObject({ code: 'TOO_LARGE' });
    });
    expect(result.current.stage).toBeNull();
  });
});
