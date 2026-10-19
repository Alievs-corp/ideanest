/**
 * What a campaign card shows as its cover, and the clip that previews over it.
 *
 * The discovery `Card` (and the profile and collection cards) carry the uploaded cover as
 * `image` and, when the campaign has a READY video, that video as `video`. A campaign with a
 * video is covered by it: the card's still is the video's own poster, and the clip plays over
 * it on hover (web) or while the card is held (app). Both clients ask this module which still
 * to draw, so a card cannot show one picture on a phone and another in a browser.
 */

/** A card's preview clip, as the wire carries it. Muted and looping wherever it plays. */
export interface CardVideo {
  readonly url: string;
  readonly posterUrl: string;
  readonly width: number;
  readonly height: number;
}

/** The still to draw, and the clip to preview over it when there is one. */
export interface CardCover {
  /** `null` for a campaign with neither a cover nor a video: the frame's own surface shows. */
  readonly url: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly video: CardVideo | null;
}

/** A card as the wire really is: nulls omitted, so every field optional. */
export interface WireCardMedia {
  image?: { url?: string | null; width?: number | null; height?: number | null } | null;
  video?: {
    url?: string | null;
    posterUrl?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
}

/**
 * The cover a card draws. The video's poster when the card has a usable video, otherwise the
 * uploaded cover; a video missing any of its four fields is treated as absent, so a card never
 * previews a clip it has no still for.
 */
export function cardCoverFrom(card: WireCardMedia): CardCover {
  const video = usableVideo(card.video);
  if (video !== null) {
    return { url: video.posterUrl, width: video.width, height: video.height, video };
  }

  const image = card.image;
  const url = image?.url != null && image.url !== '' ? image.url : null;
  return {
    url,
    width: url === null ? null : positive(image?.width),
    height: url === null ? null : positive(image?.height),
    video: null,
  };
}

function usableVideo(raw: WireCardMedia['video']): CardVideo | null {
  if (raw == null) return null;
  const width = positive(raw.width);
  const height = positive(raw.height);
  if (raw.url == null || raw.url === '' || raw.posterUrl == null || raw.posterUrl === '') return null;
  if (width === null || height === null) return null;
  return { url: raw.url, posterUrl: raw.posterUrl, width, height };
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
