/**
 * What `useImageUpload` loads once a file has been chosen: the transfer, and the words for a
 * refusal of it.
 *
 * A module of its own, imported dynamically, because neither half is needed before somebody
 * picks a picture — and the story and rewards routes had no first-load budget left for them
 * when #313 gave both an uploader. The sentence for a refusal rides with the transfer since a
 * refusal can only come out of it.
 */

import type {
  CoverFailureCode,
  CoverFailureCopy,
  ImageUploadCopy,
} from '@ideanest/campaign-editor/copy';
import { fillPlaceholders } from '../i18n/placeholders';
import { UploadFailed } from './upload';

export { uploadImage } from './upload';

/** The service's floor, `MediaAsset.MINIMUM_EDGE`: below this on either side it answers `TOO_SMALL`. */
export const MEDIA_MINIMUM_EDGE = 320;

const MINIMUM = `${MEDIA_MINIMUM_EDGE}×${MEDIA_MINIMUM_EDGE}`;

/**
 * The sentence for an upload that did not produce an image.
 *
 * Keyed on the service's code rather than rendering its sentence, because the sentence is
 * English for a log and this is read by somebody deciding what to do next. An unknown code
 * falls through to the service's own message: the deployment may refuse for a reason this
 * build has never heard of, and its sentence is better than silence. Anything that is not an
 * `UploadFailed` — a dropped connection, most realistically — is `unusable`, because the
 * browser's own message for it is English whatever the reader's language.
 */
export function describeUploadFailure(cause: unknown, copy: ImageUploadCopy): string {
  if (!(cause instanceof UploadFailed)) return copy.unusable;
  if (isKnownCode(cause.code, copy.failures)) {
    /*
     * The minimum is filled here and nowhere else. The cover rendered `{minimum}` literally
     * until this was shared, because its own code path never filled the one template among
     * the twelve.
     */
    return fillPlaceholders(copy.failures[cause.code], { minimum: MINIMUM });
  }
  return cause.message === '' ? copy.unusable : cause.message;
}

/**
 * Whether the copy has a sentence for this code. Asked of the copy rather than of
 * `COVER_FAILURE_CODES`, which is the same list: importing it would put the campaign editor's
 * code lists into every route with an image field.
 */
function isKnownCode(code: string, failures: CoverFailureCopy): code is CoverFailureCode {
  return Object.prototype.hasOwnProperty.call(failures, code);
}
