import Image from 'next/image';
import { MediaFrame } from '@ideanest/ui/server';
import { formatVideoDuration, videoSeconds } from '@ideanest/campaign-editor/video';
import { PRELAUNCH_COVER_SIZES } from '../../lib/images/sizes';
import { canOptimise } from '../../lib/images/source';
import type { CampaignPage } from '../../lib/projects/publicPage';
import { getTranslations } from 'next-intl/server';
import { CampaignVideoPlayer } from './CampaignVideoPlayer';

/**
 * §4.4's media player — issues #281 and #331. Poster-first, no autoplay, video on the press.
 *
 * <h2>Why the play control waited for a video to play</h2>
 *
 * #281 built this as a poster with the play branch written and unreachable, because no
 * response carried a video and §13.2's pipeline did not exist. A play button over a campaign's
 * cover that does nothing when pressed is worse than no button: it is a promise the page cannot
 * keep, made at the top of the page, to somebody deciding whether the creator keeps promises.
 *
 * #331 built the pipeline: a creator uploads one clip of up to sixty seconds, the server
 * transcodes it to a single 720p MP4 with its index at the front, and `ProjectPageResponse`
 * carries it as `video`. The branch is reachable now, and still only for a campaign that has
 * one — `readCampaignPage` reads a video with any of its measured fields missing as no video at
 * all, so the button never appears over something that cannot play.
 *
 * <h2>Poster-first is a decision that survived the video arriving</h2>
 *
 * "No autoplay" is not a preference. This is the largest element on the largest-contentful-
 * paint-sensitive route in the application (#119), it is the first thing a reader sees, and an
 * autoplaying video costs the connection of somebody on mobile data before they have decided
 * they want it. So the poster is what is served — the cover when the campaign has one, which is
 * the picture the creator chose for the top of their page, and the video's own still when it
 * does not — and the clip is fetched on the press, by `CampaignVideoPlayer`, the client island
 * that owns the press and mounts the `<video>` element. Nothing else in this header became a
 * client component because of it.
 *
 * <h2>The box is reserved before anything decodes</h2>
 *
 * `MediaFrame` sets the 16:9 crop up front, so the page's largest element does not change
 * height when the photograph arrives, or when the video replaces it. That is the layout shift
 * the Core Web Vitals budget in CI measures, and it is why the frame is rendered even for a
 * campaign with no cover at all.
 *
 * <h2>The alt text is empty, deliberately</h2>
 *
 * §9.2 of docs/ui-kit.md forbids colour alone carrying meaning and §9.4 asks for accessible
 * names on controls; neither asks for a description of a decorative photograph. The campaign
 * title is the `<h1>` immediately beside this, so a screen reader that announced the cover as
 * "A coffee table book" would read the same words twice. The service stores no alternative
 * text for a cover — there is no column for one — and inventing a description from the title
 * is exactly that duplication. An empty `alt` takes the image out of the accessibility tree,
 * which is the correct answer for an image whose content is already stated in text. The play
 * control is not decorative, and it is named: what it plays, and for how long.
 */

export interface CampaignMediaProps {
  readonly campaign: CampaignPage;
}

export async function CampaignMedia({ campaign }: CampaignMediaProps) {
  const t = await getTranslations('campaign.media');

  const { video } = campaign;
  const poster = campaign.coverImage?.url ?? video?.posterUrl ?? null;

  return (
    <MediaFrame ratio="16/9" radius="lg">
      {poster !== null && (
        <Image
          src={poster}
          alt=""
          fill
          /*
           * The prelaunch stops, reused. The two layouts are not identical — this column is
           * `minmax(0,1.6fr)` inside a 1200px container rather than a 720px measure — so the
           * request is a little conservative at the widest breakpoint. Correcting it is an
           * entry in `lib/images/sizes.ts`, which is that module's to add: it exists so that
           * every `sizes` string is written next to the Tailwind classes it mirrors, and a
           * hand-rolled string here would be the stale constant it was written to prevent.
           */
          sizes={PRELAUNCH_COVER_SIZES}
          /*
           * An address on a host the optimiser will not fetch is served as it is rather than
           * thrown over: `next/image` raises on a URL no remote pattern matches, and a raised
           * render in a Server Component takes the whole page down. One creator's typo must
           * not be able to do that.
           */
          unoptimized={!canOptimise(poster)}
          priority
          className="object-cover"
        />
      )}

      {video !== null && (
        <CampaignVideoPlayer
          src={video.url}
          poster={video.posterUrl}
          playLabel={t('play')}
          playName={t('playName', { seconds: videoSeconds(video.durationMs) })}
          duration={formatVideoDuration(video.durationMs)}
          videoLabel={t('videoLabel')}
        />
      )}
    </MediaFrame>
  );
}
