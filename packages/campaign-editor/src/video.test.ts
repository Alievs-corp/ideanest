import { describe, expect, it } from 'vitest';
import {
  VIDEO_MAX_BYTES,
  formatVideoDuration,
  videoContentType,
  videoPreflightRefusal,
  videoSeconds,
} from './video';

/**
 * The places the video check fails: sixty seconds and the half second after it, 250MB and the
 * byte after that, and a browser that reports no type for a perfectly good `.mov`.
 */

describe('videoPreflightRefusal', () => {
  const ok = { byteSize: 12_000_000, durationMs: 42_000 };

  it('lets a clip of sixty seconds through, and the container rounding the service allows', () => {
    expect(videoPreflightRefusal({ ...ok, durationMs: 60_000 })).toBeNull();
    expect(videoPreflightRefusal({ ...ok, durationMs: 60_500 })).toBeNull();
  });

  it('refuses the clip the service would refuse, and not one millisecond earlier', () => {
    expect(videoPreflightRefusal({ ...ok, durationMs: 60_501 })).toBe('TOO_LONG');
    expect(videoPreflightRefusal({ ...ok, durationMs: 95_000 })).toBe('TOO_LONG');
  });

  it('does not refuse a length it could not read, because the service will measure it', () => {
    expect(videoPreflightRefusal({ ...ok, durationMs: null })).toBeNull();
  });

  it('refuses a file over the ceiling before a byte of it is sent', () => {
    expect(videoPreflightRefusal({ ...ok, byteSize: VIDEO_MAX_BYTES })).toBeNull();
    expect(videoPreflightRefusal({ ...ok, byteSize: VIDEO_MAX_BYTES + 1 })).toBe('TOO_LARGE');
  });

  it('refuses an empty file rather than uploading nothing', () => {
    expect(videoPreflightRefusal({ byteSize: 0, durationMs: null })).toBe('EMPTY');
  });
});

describe('videoContentType', () => {
  it('declares what the browser reported when it is a video', () => {
    expect(videoContentType({ type: 'video/mp4', name: 'clip.mp4' })).toBe('video/mp4');
    expect(videoContentType({ type: 'video/quicktime', name: 'IMG_0042.MOV' })).toBe(
      'video/quicktime',
    );
  });

  it('reads the extension when the browser reported nothing', () => {
    expect(videoContentType({ type: '', name: 'IMG_0042.MOV' })).toBe('video/quicktime');
    expect(videoContentType({ type: 'application/octet-stream', name: 'clip.webm' })).toBe(
      'video/webm',
    );
  });

  it('is null for anything that is not a video, whatever it is called', () => {
    expect(videoContentType({ type: 'image/jpeg', name: 'clip.mp4' })).toBeNull();
    expect(videoContentType({ type: '', name: 'notes.txt' })).toBeNull();
    expect(videoContentType({ type: '', name: 'no-extension' })).toBeNull();
  });
});

describe('formatVideoDuration', () => {
  it('reads like a player clock', () => {
    expect(formatVideoDuration(42_000)).toBe('0:42');
    expect(formatVideoDuration(72_000)).toBe('1:12');
    expect(formatVideoDuration(5_000)).toBe('0:05');
  });

  it('rounds the way a player does, so the limit reads as the limit', () => {
    expect(formatVideoDuration(59_600)).toBe('1:00');
    expect(formatVideoDuration(400)).toBe('0:00');
  });
});

describe('videoSeconds', () => {
  it('never says a clip lasts no seconds at all', () => {
    expect(videoSeconds(42_400)).toBe(42);
    expect(videoSeconds(300)).toBe(1);
  });
});
