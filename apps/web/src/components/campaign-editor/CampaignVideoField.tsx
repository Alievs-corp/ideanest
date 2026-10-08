'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Field, FileDropZone, InlineAlert, MediaFrame, Pill } from '@ideanest/ui';
import type { CampaignVideo } from '../../lib/projects/api';
import {
  VIDEO_FAILURE_CODES,
  type CampaignVideoCopy,
  type VideoFailureCode,
} from '@ideanest/campaign-editor/copy';
import {
  VIDEO_ACCEPT,
  VIDEO_MAX_MEGABYTES,
  VIDEO_MAX_SECONDS,
  formatVideoDuration,
  videoContentType,
  videoPreflightRefusal,
} from '@ideanest/campaign-editor/video';
import { describeSize } from '@ideanest/campaign-editor/cover-image';
import { UploadFailed } from '../../lib/media/upload';
import {
  VideoStillProcessing,
  resumeVideo,
  uploadVideo,
  type UploadedVideo,
} from '../../lib/media/videoUpload';
import { readVideoDuration } from '../../lib/media/videoDuration';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * The campaign video — issue #331, docs/architecture.md §13.2.
 *
 * <h2>Four stages, and each one says so</h2>
 *
 * A cover is chosen and set within a couple of seconds, so its field can get away with a
 * sentence per stage. A video cannot. The upload is minutes of a phone connection and the
 * transcode is up to a minute after it, and a field that showed "uploading…" for six minutes
 * would be indistinguishable from one that had stopped. So:
 *
 *   1. **checking** — the length is read from the file's own header, in this browser, before
 *      anything is sent. A ninety-second clip is refused here, with how long it actually runs,
 *      instead of after a ten-minute upload. The size is refused before even that.
 *   2. **preparing** — the service issues a presigned address.
 *   3. **uploading** — the bytes go straight to the bucket, with a real progress bar driven by
 *      the transfer's own byte count (`uploadVideo` uses `XMLHttpRequest` for exactly this).
 *   4. **processing** — the server transcodes. There is no honest percentage to show for an
 *      ffmpeg pass on a shared host, so there is none: the stage says what is happening and how
 *      long it can take.
 *
 * Only then does anything reach the draft. `onAccept` is called with a READY video and nothing
 * earlier, so autosave never sends the identifier of a clip that does not yet play — which the
 * service would refuse with `PROJECT_FIELD_INVALID` in any case. What the field then says is
 * that the video is READY, not that it is saved: the save is the autosave's to report, in the
 * header, and it can still be refused.
 *
 * <h2>Leaving the page stops the upload, and the page says so before it happens</h2>
 *
 * Unmounting aborts whatever is in flight: the transfer itself if it is still running, so a
 * creator who navigates away is not still spending their data allowance in the background, and
 * the poll if it is not. Nothing attaches a clip nobody is waiting for. That is a real loss after
 * minutes of uploading, so from the first byte onwards the panel says, in a sentence that stays
 * on screen, that leaving the page or switching editor tab stops it — and closing or reloading
 * the browser tab asks first (`beforeunload`, registered only while there is something to lose,
 * so the page stays eligible for the back-forward cache the rest of the time). The editor's own
 * tab links are ordinary links and the editor has no navigation guard to hook into; the sentence
 * is what covers them.
 *
 * <h2>A slow transcode is not a lost upload</h2>
 *
 * After five minutes of polling the field stops and says the conversion is taking longer than
 * usual — but the upload is kept. The server works through a queue, and a clip behind two others
 * is routinely READY a few minutes later; "Check again" resumes waiting on the same upload rather
 * than asking the creator to send the file a second time.
 *
 * <h2>Motion: none</h2>
 *
 * The campaign editor's budget is the autosave indicator and nothing else
 * (docs/motion-system.md §5). The progress fill is moved with `transform` and has no
 * transition: it jumps to each new value, which on an upload that reports every few hundred
 * milliseconds reads as steady progress without animating anything.
 */

export interface CampaignVideoFieldProps {
  copy: CampaignVideoCopy;
  video: CampaignVideo | null;
  disabled?: boolean;
  /** A message about the saved value — the service refusing to attach it. */
  error?: string;
  /**
   * A READY video. Called after an upload that may have taken minutes, so the caller must apply
   * it to the form as it is THEN, not as it was when the file was chosen.
   */
  onAccept: (video: CampaignVideo) => void;
  onRemove: () => void;
}

type Stage = 'checking' | 'preparing' | 'uploading' | 'processing';

type Note = { tone: 'success' | 'danger'; title?: string; text: string };

export function CampaignVideoField({
  copy,
  video,
  disabled = false,
  error,
  onAccept,
  onRemove,
}: CampaignVideoFieldProps) {
  const [stage, setStage] = useState<Stage | null>(null);
  /** How much of the file has reached storage, 0 to 1. Meaningful only while `uploading`. */
  const [sent, setSent] = useState(0);
  const [note, setNote] = useState<Note | null>(null);
  /** An upload that outlasted the poll and may still become ready: "Check again" waits on it. */
  const [stillProcessing, setStillProcessing] = useState<string | null>(null);

  /* One upload at a time. Choosing another file abandons the first rather than racing it. */
  const inFlight = useRef<AbortController | null>(null);
  /* The picker behind "Replace video", which has no drop zone of its own to borrow. */
  const replacePicker = useRef<HTMLInputElement>(null);
  const keepOpenId = useId();

  useEffect(() => () => inFlight.current?.abort(), []);

  const busy = stage !== null;
  /** From the first byte on, leaving the page throws work away. */
  const atRisk = stage === 'uploading' || stage === 'processing';

  useEffect(() => {
    if (!atRisk) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Older engines show the prompt only when `returnValue` is set; its text is ignored.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [atRisk]);

  const panel = busy ? 'busy' : video !== null ? 'preview' : 'empty';

  /*
   * KEEPING FOCUS WHEN THE PANEL UNDER IT GOES AWAY. Choosing a file replaces the drop zone with
   * the progress panel, finishing replaces that with the preview, and Remove brings the drop
   * zone back — each time removing the very button a keyboard user had just pressed, which
   * drops their focus to the top of the document. When that has happened, and only then, focus
   * goes to the first control of whatever replaced it. A creator who has moved on to the title
   * field while the clip transcodes is left exactly where they are.
   */
  const region = useRef<HTMLDivElement>(null);
  const shown = useRef(panel);
  useEffect(() => {
    if (shown.current === panel) return;
    shown.current = panel;

    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    region.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [panel]);

  function refused(text: string): void {
    setNote({ tone: 'danger', title: copy.notUsedTitle, text });
  }

  function describeFailure(cause: unknown): string {
    if (cause instanceof UploadFailed) {
      // The service's sentence only when this build has no words for its code: it is English
      // written for a log, and every code it sends today is in the catalogue.
      return refusalFor(copy, cause.code) ?? (cause.message === '' ? copy.unusable : cause.message);
    }
    return copy.unusable;
  }

  /**
   * Runs one attempt — an upload, or a resumed wait — and reports how it ended.
   *
   * `work` answers `null` when it refused the file itself and has already said why.
   */
  async function attempt(
    first: Stage,
    work: (signal: AbortSignal) => Promise<UploadedVideo | null>,
  ): Promise<void> {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setNote(null);
    setStillProcessing(null);
    setSent(0);
    setStage(first);

    try {
      const ready = await work(controller.signal);
      if (ready === null) return;

      onAccept({
        mediaId: ready.mediaId,
        url: ready.url,
        posterUrl: ready.posterUrl,
        width: ready.width,
        height: ready.height,
        durationMs: ready.durationMs,
        blurDataUrl: ready.blurDataUrl,
      });
      setNote({ tone: 'success', text: copy.set });
    } catch (cause) {
      // Cancelled, replaced by another file, or the field went away. Nothing to report.
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (cause instanceof VideoStillProcessing) setStillProcessing(cause.mediaId);
      refused(describeFailure(cause));
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setStage(null);
      }
    }
  }

  async function upload(file: File): Promise<void> {
    const contentType = videoContentType(file);
    if (contentType === null) {
      setStillProcessing(null);
      refused(copy.failures.NOT_A_VIDEO);
      return;
    }
    // The size needs nothing read, so it is refused before the header is.
    const tooBig = videoPreflightRefusal({ byteSize: file.size, durationMs: null });
    if (tooBig !== null) {
      setStillProcessing(null);
      refused(refusalFor(copy, tooBig) ?? copy.unusable);
      return;
    }

    await attempt('checking', async (signal) => {
      const durationMs = await readVideoDuration(file, signal);
      if (
        durationMs !== null &&
        videoPreflightRefusal({ byteSize: file.size, durationMs }) === 'TOO_LONG'
      ) {
        refused(
          fillPlaceholders(copy.tooLong, {
            duration: formatVideoDuration(durationMs),
            seconds: String(VIDEO_MAX_SECONDS),
          }),
        );
        return null;
      }

      return await uploadVideo(file, { contentType, signal, onStage: setStage, onProgress: setSent });
    });
  }

  function checkAgain(mediaId: string): void {
    void attempt('processing', (signal) => resumeVideo(mediaId, { signal }));
  }

  function choose(files: readonly File[]): void {
    const [first] = files;
    if (first) void upload(first);
  }

  const percent = Math.round(sent * 100);
  const percentText = fillPlaceholders(copy.progress, { percent: String(percent) });

  return (
    <Field
      grouped
      label={copy.label}
      hint={fillPlaceholders(copy.hint, { seconds: String(VIDEO_MAX_SECONDS) })}
      error={error}
    >
      <div ref={region} className="flex flex-col gap-3">
        {video !== null && !busy && (
          <figure className="overflow-hidden rounded-lg border border-white/8 bg-surface-2">
            {/*
              THE CAMPAIGN PAGE'S BOX, NOT THE CLIP'S. The page reserves a 16:9 frame and
              letterboxes the video inside it (`CampaignMedia`), so a portrait clip from a phone
              is shown here exactly as a backer will see it — with the bars — rather than as a
              tall preview that promises a layout the page does not have.

              `preload="none"`: the poster is what a creator checks, and the clip is fetched only
              if they press play on it.
            */}
            <MediaFrame ratio="16/9" placeholder={video.blurDataUrl ?? undefined}>
              <video
                controls
                playsInline
                preload="none"
                poster={video.posterUrl}
                src={video.url}
                aria-label={copy.previewLabel}
                className="absolute inset-0 size-full object-contain"
              />
            </MediaFrame>
            <figcaption className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] text-white/64">
              <span>
                {fillPlaceholders(copy.caption, {
                  duration: formatVideoDuration(video.durationMs),
                  size: describeSize(video),
                })}
              </span>
              <span className="flex flex-wrap gap-2">
                <Pill
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => replacePicker.current?.click()}
                >
                  {copy.replace}
                </Pill>
                <Pill
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    setNote(null);
                    onRemove();
                  }}
                >
                  {copy.remove}
                </Pill>
              </span>
            </figcaption>
            {/*
              Hidden, and reached only through "Replace video" above, which is the control a
              keyboard or a screen reader meets. The drop zone's own picker works the same way.
            */}
            <input
              ref={replacePicker}
              type="file"
              hidden
              accept={VIDEO_ACCEPT}
              disabled={disabled}
              onChange={(event) => {
                choose(Array.from(event.currentTarget.files ?? []));
                // Choosing the same file again must fire `change` again.
                event.currentTarget.value = '';
              }}
            />
          </figure>
        )}

        {video === null && !busy && (
          <FileDropZone
            accept={VIDEO_ACCEPT}
            disabled={disabled}
            prompt={copy.prompt}
            dragPrompt={copy.dragPrompt}
            buttonLabel={copy.buttonLabel}
            hint={fillPlaceholders(copy.dropHint, { megabytes: String(VIDEO_MAX_MEGABYTES) })}
            onFiles={choose}
          />
        )}

        {busy && (
          <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-surface-2 p-5">
            {stage === 'uploading' && (
              <div className="flex items-center gap-3">
                {/*
                  Not `ProgressBar`. That one is FUNDING progress: lime while short of the goal
                  and `--success` with a glow at 100%, and an upload reaching its last byte has
                  achieved nothing a backer would recognise (docs/ui-kit.md §8.1). A neutral
                  white fill on the same track says "this far" and no more.
                */}
                <div
                  role="progressbar"
                  aria-label={copy.progressLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-valuetext={percentText}
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
                >
                  <div
                    className="h-full w-full rounded-full bg-white"
                    style={{ transform: `translateX(${percent - 100}%)` }}
                  />
                </div>
                {/* The bar's value already carries the figure for a screen reader. */}
                <span
                  aria-hidden="true"
                  className="w-12 text-right text-[13px] tabular-nums text-white/64"
                >
                  {percentText}
                </span>
              </div>
            )}
            {/*
              On screen for as long as leaving would lose something, and not in the live region:
              it does not change, and the Cancel button names it as its description, so it is
              heard where the focus lands when the upload starts.
            */}
            {atRisk && (
              <p id={keepOpenId} className="text-[13px] text-white/64">
                {copy.keepOpen}
              </p>
            )}
            <div>
              <Pill
                variant="ghost"
                size="sm"
                aria-describedby={atRisk ? keepOpenId : undefined}
                onClick={() => {
                  inFlight.current?.abort();
                  setNote(null);
                }}
              >
                {copy.cancel}
              </Pill>
            </div>
          </div>
        )}

        {/*
          The stage, and the outcome, announced politely — `CoverImageField` explains why the
          refusal is a separate `alert` rather than a second message in this region. The stage
          sentence changes four times in an upload, not on every progress event, so a screen
          reader hears where the upload is without hearing every percent of it.

          "Ready" is withdrawn the moment the service refuses to attach the clip: a success note
          beside the field's own error would be the field contradicting itself.
        */}
        <div role="status" aria-live="polite" className="empty:hidden">
          {stage !== null && <InlineAlert variant="info">{copy.stage[stage]}</InlineAlert>}
          {stage === null && error === undefined && note !== null && note.tone === 'success' && (
            <InlineAlert variant="success">{note.text}</InlineAlert>
          )}
        </div>

        {!busy && note !== null && note.tone === 'danger' && (
          <InlineAlert variant="danger" title={note.title}>
            <p>{note.text}</p>
            {stillProcessing !== null && (
              <Pill
                variant="ghost"
                size="sm"
                className="mt-3"
                disabled={disabled}
                onClick={() => checkAgain(stillProcessing)}
              >
                {copy.checkAgain}
              </Pill>
            )}
          </InlineAlert>
        )}
      </div>
    </Field>
  );
}

/**
 * The sentence for a refusal this build knows, with its limit filled in, or `null`.
 *
 * An unknown code falls through to the caller: the deployment may refuse for a reason this
 * build has never heard of, and its own sentence is better than silence.
 */
function refusalFor(copy: CampaignVideoCopy, code: string): string | null {
  if (!isKnownCode(code)) return null;
  return fillPlaceholders(copy.failures[code], {
    seconds: String(VIDEO_MAX_SECONDS),
    megabytes: String(VIDEO_MAX_MEGABYTES),
  });
}

function isKnownCode(code: string): code is VideoFailureCode {
  return (VIDEO_FAILURE_CODES as readonly string[]).includes(code);
}
