import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import type { CampaignVideo } from '@ideanest/campaign-editor/contract';
import { useT, type Translate } from '../../lib/i18n';
import {
  UploadFailed,
  VIDEO_MAX_DURATION_MS,
  forgetPicked,
  isAbortError,
  isVideoTooLarge,
  isVideoTooLong,
  resumeVideo,
  uploadVideo,
  type UploadStage,
  type UploadedVideo,
} from '../../lib/media/upload';

/**
 * The campaign video's upload, held by the editor rather than by its field — issue #331.
 *
 * <h2>Why it lives above the tabs</h2>
 *
 * A minute of video takes minutes to send and about a minute more to transcode, and the editor's
 * tabs are routes: switching from Basics to Story unmounts the Basics tab. An upload owned by the
 * field died with it, silently, half-way through. `EditorProvider` calls this hook, so the upload,
 * its poll and the attach outlive any tab and only stop when the editor itself closes. The field
 * (`VideoField`) only draws what this says.
 *
 * <h2>What it does</h2>
 *
 * <ul>
 *   <li>`pick()` opens the library for videos only (`VIDEO_PICKER_OPTIONS`), refuses a clip over
 *       a minute or over 250 MB from the picker's own figures before a byte is sent, uploads, and
 *       once the service says READY saves `{videoMediaId}` through the editor's autosave.</li>
 *   <li>A wait that ran out (`UPLOAD_STILL_PROCESSING`) keeps the upload's id: `checkAgain()` asks
 *       about the same upload again rather than discarding a file that may be a moment from
 *       READY.</li>
 *   <li>A `videoMediaId` the service refused (a field error on save) is taken back out of the
 *       autosave's queue and its stored offer (`forget`) — otherwise every later save would carry
 *       it and be refused too — and the field returns to the saved video with the service's words.</li>
 *   <li>`remove()` saves `{videoMediaId: null}`.</li>
 * </ul>
 *
 * <p>What the field shows is the video chosen here until the saved project agrees with it, then the
 * saved project's own.
 */

/** The media service's codes with a sentence of their own in `mobile.editor.video.failures`. */
export const VIDEO_FAILURE_CODES = [
  'TOO_LONG',
  'TOO_LARGE',
  'UNSUPPORTED_FORMAT',
  'EMPTY',
  'TOO_SMALL',
  'UNREADABLE',
  'UPLOADS_UNAVAILABLE',
  'MEDIA_STORAGE_UNREACHABLE',
  'UPLOAD_STILL_PROCESSING',
  'UPLOAD_TRANSFER_FAILED',
  'UPLOAD_REFUSED',
  'UPLOAD_UNFINISHED',
  'MEDIA_NOT_FOUND',
] as const;

type VideoFailureCode = (typeof VIDEO_FAILURE_CODES)[number];

function isVideoFailureCode(code: string): code is VideoFailureCode {
  return (VIDEO_FAILURE_CODES as readonly string[]).includes(code);
}

/** A refusal in the catalogue's words: the code's sentence, else the service's own, else "unusable". */
export function describeVideoFailure(cause: unknown, t: Translate): string {
  if (cause instanceof UploadFailed) {
    if (isVideoFailureCode(cause.code)) return t(`mobile.editor.video.failures.${cause.code}`);
    if (cause.message !== '') return cause.message;
  }
  return t('mobile.editor.video.unusable');
}

/**
 * The service's sentence when a save was refused because of its `videoMediaId`, else null.
 *
 * The service answers `400 PROJECT_FIELD_INVALID` with `meta.field` naming the key (an upload that
 * is not the caller's, not a video, or not finished); a validation failure's `errors` map is read
 * too, in case the key is ever refused that way.
 */
export function videoRefusalOf(failure: SaveFailure | null): string | null {
  if (failure === null) return null;
  const listed = failure.fieldErrors['videoMediaId'] ?? failure.fieldErrors['video'];
  if (listed !== undefined) return listed;
  if (failure.code === 'PROJECT_FIELD_INVALID' && failure.meta?.['field'] === 'videoMediaId') return failure.message;
  return null;
}

/**
 * The picker's options. `videoMaxDuration` caps a recording, and on iOS the trim UI that
 * `allowsEditing` turns on; `videoExportPreset` is iOS's export, and is ignored on Android.
 */
export const VIDEO_PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['videos'],
  allowsEditing: true,
  videoMaxDuration: VIDEO_MAX_DURATION_MS / 1000,
  videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
};

export interface VideoFailure {
  readonly title?: string;
  readonly text: string;
}

export interface VideoUpload {
  /** What the field shows: the video chosen here, until the saved project agrees, then the saved one. */
  readonly video: CampaignVideo | null;
  readonly stage: UploadStage | null;
  /** Whole percent of the bytes sent, while `stage` is `uploading`. */
  readonly percent: number;
  /** Something is being picked, uploaded, processed or asked about again. */
  readonly busy: boolean;
  readonly failure: VideoFailure | null;
  /** The last upload was attached, and nothing has gone wrong since. */
  readonly added: boolean;
  /** An upload outlived the wait; `checkAgain` asks about it again. */
  readonly canCheckAgain: boolean;
  readonly pick: () => Promise<void>;
  readonly checkAgain: () => Promise<void>;
  readonly remove: () => void;
}

export interface VideoUploadOptions {
  /** The saved project's video. */
  readonly saved: CampaignVideo | null;
  /** Queue this patch on the editor's autosave and send it now. */
  readonly save: (patch: { readonly videoMediaId: string | null }) => void;
  /** The service's sentence when it refused the `videoMediaId` it was sent, else null. */
  readonly refusal: string | null;
  /** Take `videoMediaId` out of the autosave's queue and its stored offer. */
  readonly forget: () => void;
  /** Whether a `videoMediaId` is still waiting in the autosave. */
  readonly pending: boolean;
}

function asCampaignVideo(uploaded: UploadedVideo): CampaignVideo {
  return {
    mediaId: uploaded.mediaId,
    url: uploaded.url,
    posterUrl: uploaded.posterUrl,
    width: uploaded.width,
    height: uploaded.height,
    durationMs: uploaded.durationMs,
    blurDataUrl: uploaded.blurDataUrl === '' ? null : uploaded.blurDataUrl,
  };
}

export function useVideoUpload({ saved, save, refusal, forget, pending }: VideoUploadOptions): VideoUpload {
  const t = useT('mobile.editor.video');
  const tAll = useT();
  /** `undefined`: show the saved video. Otherwise what was chosen or removed here, not yet saved. */
  const [chosen, setChosen] = useState<CampaignVideo | null | undefined>(undefined);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<VideoFailure | null>(null);
  const [added, setAdded] = useState(false);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Read through refs: the editor hands new functions every render.
  const saveRef = useRef(save);
  const forgetRef = useRef(forget);
  useEffect(() => {
    saveRef.current = save;
    forgetRef.current = forget;
  }, [save, forget]);

  // Closing the editor abandons the upload; switching tabs does not reach here.
  useEffect(() => () => inFlight.current?.abort(), []);

  // Once the saved project agrees with what was chosen here, it is the authority again.
  const savedId = saved?.mediaId ?? null;
  const chosenId = chosen === undefined ? undefined : (chosen?.mediaId ?? null);
  useEffect(() => {
    if (chosenId !== undefined && !pending && chosenId === savedId) setChosen(undefined);
  }, [chosenId, savedId, pending]);

  // A refused id must not ride along with every later save.
  useEffect(() => {
    if (refusal === null) return;
    forgetRef.current();
    setChosen(undefined);
    setAdded(false);
    setFailure({ title: t('notUsedTitle'), text: refusal });
  }, [refusal, t]);

  const attach = useCallback((video: CampaignVideo) => {
    setChosen(video);
    setWaitingFor(null);
    saveRef.current({ videoMediaId: video.mediaId });
    setAdded(true);
  }, []);

  /** Runs one upload step under a fresh controller, with the stage, busy and failure around it. */
  const run = useCallback(
    async (work: (signal: AbortSignal) => Promise<UploadedVideo>, picked: string | null): Promise<void> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setBusy(true);
      setPercent(0);
      try {
        const uploaded = await work(controller.signal);
        if (controller.signal.aborted) return;
        attach(asCampaignVideo(uploaded));
      } catch (cause) {
        if (isAbortError(cause) || controller.signal.aborted) return;
        if (cause instanceof UploadFailed && cause.code === 'UPLOAD_STILL_PROCESSING' && cause.mediaId !== null) {
          setWaitingFor(cause.mediaId);
        }
        setFailure({ title: t('notUsedTitle'), text: describeVideoFailure(cause, tAll) });
      } finally {
        // The picker's copy in the cache: a minute of video is not something to leave behind.
        if (picked !== null) forgetPicked(picked);
        if (inFlight.current === controller) {
          inFlight.current = null;
          setStage(null);
          setBusy(false);
        }
      }
    },
    [attach, t, tAll],
  );

  const pick = useCallback(async (): Promise<void> => {
    Keyboard.dismiss();
    setFailure(null);
    setAdded(false);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync(VIDEO_PICKER_OPTIONS);
    } catch {
      setFailure({ text: t('openFailed') });
      return;
    }
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset === undefined) return;

    const refuse = (code: VideoFailureCode) => {
      forgetPicked(asset.uri);
      setFailure({ title: t('notUsedTitle'), text: t(`failures.${code}`) });
    };
    if (isVideoTooLong(asset.duration)) return refuse('TOO_LONG');
    if (isVideoTooLarge(asset.fileSize)) return refuse('TOO_LARGE');

    setWaitingFor(null);
    await run(
      (signal) =>
        uploadVideo(asset.uri, {
          signal,
          mimeType: asset.mimeType ?? null,
          onStage: setStage,
          // A state update only when the whole percent moves: React drops a set to the same value,
          // so a progress event per network chunk does not re-render the field for each one.
          onProgress: (fraction) => setPercent(Math.floor(fraction * 100)),
        }),
      asset.uri,
    );
  }, [run, t]);

  const checkAgain = useCallback(async (): Promise<void> => {
    if (waitingFor === null) return;
    setFailure(null);
    await run((signal) => resumeVideo(waitingFor, { signal, onStage: setStage }), null);
  }, [run, waitingFor]);

  const remove = useCallback(() => {
    inFlight.current?.abort();
    setWaitingFor(null);
    setFailure(null);
    setAdded(false);
    setChosen(null);
    saveRef.current({ videoMediaId: null });
  }, []);

  const video = chosen === undefined ? saved : chosen;
  return useMemo(
    () => ({
      video,
      stage,
      percent,
      busy,
      failure,
      added,
      canCheckAgain: waitingFor !== null && !busy,
      pick,
      checkAgain,
      remove,
    }),
    [video, stage, percent, busy, failure, added, waitingFor, pick, checkAgain, remove],
  );
}
