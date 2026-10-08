/**
 * The campaign video's rules — issue #331, docs/architecture.md §13.2.
 *
 * ONE CLIP, AT MOST SIXTY SECONDS, AT MOST 250MB AS UPLOADED. The service measures both on
 * arrival and refuses with `TOO_LONG` or `TOO_LARGE` whatever a client says, so nothing here is
 * a security boundary. What it is is courtesy: a creator on a phone connection should learn
 * that a ninety-second clip is too long BEFORE spending ten minutes uploading it, not after.
 *
 * ONLY THE RULE IS HERE, the way `./cover-image` holds only the cover's. How a clip's length is
 * read is each client's own — the web loads the file's metadata into a detached `<video>`
 * element, the app reads the duration the picker reports — and both ask this module what the
 * number means.
 */

/** The longest clip the service accepts. */
export const VIDEO_MAX_SECONDS = 60;

/**
 * The service's own allowance for container rounding.
 *
 * A clip recorded as "one minute" on a phone is routinely 60.02 seconds in its container, and
 * refusing it here when the service would take it is the one mistake this check must not make.
 * The same half second the service allows (`FfmpegVideoTranscoder.DURATION_TOLERANCE_MS`), and
 * no more: a client more generous than the server is a client that lets somebody upload a file
 * to be told no.
 */
export const VIDEO_DURATION_SLACK_MS = 500;

/** The ceiling on the file as uploaded, before it is transcoded. 250 MiB, as the service counts. */
export const VIDEO_MAX_MEGABYTES = 250;
export const VIDEO_MAX_BYTES = VIDEO_MAX_MEGABYTES * 1024 * 1024;

/**
 * What the file picker offers.
 *
 * The three containers phones and editors actually produce, named first so a picker that
 * honours only explicit types still shows them, and then `video/*` for the rest — the service
 * decides what it can decode, by probing the bytes, and a picker that hid an AVI it would have
 * accepted is a refusal nobody can explain.
 */
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/*';

/**
 * The types a browser sometimes fails to report, by extension.
 *
 * Windows in particular hands over a `.mov` with an empty `type` when no player has registered
 * the extension. An empty type would be sent as `application/octet-stream`, which the service
 * reads as an IMAGE upload and then refuses as an unsupported format — so the extension is read
 * instead, for the containers listed in {@link VIDEO_ACCEPT} and nothing else.
 */
const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
};

/**
 * The content type to declare for a file, or `null` when it is not a video at all.
 *
 * The declared type is what tells the service this is a VIDEO upload rather than an image one
 * (`POST /v1/media/uploads`), so it has to start with `video/`. It is still only a declaration:
 * the bytes are probed on arrival.
 */
export function videoContentType(file: {
  readonly type: string;
  readonly name: string;
}): string | null {
  const declared = file.type.trim().toLowerCase();
  if (declared.startsWith('video/')) return declared;
  if (declared !== '' && declared !== 'application/octet-stream') return null;

  const dot = file.name.lastIndexOf('.');
  const extension = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase();
  return TYPE_BY_EXTENSION[extension] ?? null;
}

/** The refusals this module can make before anything is sent. A subset of the service's. */
export type VideoPreflightRefusal = 'EMPTY' | 'TOO_LARGE' | 'TOO_LONG';

/**
 * Why a clip would be refused, or `null` when it is worth uploading.
 *
 * @param durationMs the length the client read, or `null` when it could not read one. Unknown
 *     is not too long: a browser that cannot parse a container's header may still be holding a
 *     file the service can transcode, and the service measures the length itself. Refusing on
 *     "I could not tell" would turn a gap in one browser's decoders into a rule.
 */
export function videoPreflightRefusal(facts: {
  readonly byteSize: number;
  readonly durationMs: number | null;
}): VideoPreflightRefusal | null {
  if (facts.byteSize <= 0) return 'EMPTY';
  if (facts.byteSize > VIDEO_MAX_BYTES) return 'TOO_LARGE';
  const limitMs = VIDEO_MAX_SECONDS * 1000 + VIDEO_DURATION_SLACK_MS;
  if (facts.durationMs !== null && facts.durationMs > limitMs) return 'TOO_LONG';
  return null;
}

/**
 * `0:42`, `1:12` — a length as a player's own clock shows it.
 *
 * Rounded to the nearest second rather than floored, so a 59.6-second clip reads `1:00` and not
 * `0:59`: the figure a creator compares with the sixty-second limit should be the one a player
 * would show them, and players round.
 */
export function formatVideoDuration(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Whole seconds, at least one, for a sentence that counts them. */
export function videoSeconds(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 1000));
}
