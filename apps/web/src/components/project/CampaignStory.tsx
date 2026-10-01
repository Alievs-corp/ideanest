import Image from 'next/image';
import type { ReactNode } from 'react';
import { MediaFrame } from '@ideanest/ui/server';
import { canOptimise } from '../../lib/images/source';
import type { CampaignStoryCopy } from '../../lib/i18n/campaign-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { StoryBlock, StoryDocument, StorySpans } from '../../lib/projects/story';

/**
 * The creator's story, rendered — docs/ui-kit.md §8.4, the long-form exception.
 *
 * <h2>This is the reason #119 exists</h2>
 *
 * A campaign page whose body is fetched by the browser is a campaign page whose body is
 * not in the HTML: the two thousand words a creator wrote about what they are making are
 * the entire content of the page, and a crawler served an empty `<div>` has been told the
 * campaign is about nothing. Everything below is a Server Component and nothing below
 * fetches.
 *
 * <h2>The long-form exception, applied exactly as §8.4 states it</h2>
 *
 * Four changes from the system and no more: a lighter ground (`--surface-2`), softer body
 * text (`--text-reading`), generous leading, and a measure limit of 68 characters.
 * Headings stay `--text-primary`. The system is unchanged; two thousand words simply
 * become readable, and a reader who has scrolled this far is reading rather than scanning.
 *
 * <h2>No `dangerouslySetInnerHTML`, anywhere</h2>
 *
 * The story is a structured document — #35 gave it a schema and `readStoryDocument`
 * validates it — so every block below is rendered as elements. That is not a stylistic
 * preference: the document is text a creator typed, it reaches this component from a
 * public endpoint, and injecting it as markup would make a campaign page a cross-site
 * scripting vector on the origin that holds the session cookie.
 *
 * <h2>Motion</h2>
 *
 * None. §8 of docs/motion-system.md forbids animation in long content outright, and a
 * paragraph that fades in as it is scrolled past is a paragraph somebody is trying to read.
 */

/** ui-kit §8.4's measure limit. Longer lines are where a reader loses the next one. */
const MEASURE = 'max-w-[68ch]';

/** ui-kit §8.4's body: 17px on 1.75, which is the leading two thousand words need. */
const BODY = 'wrap-anywhere text-[1.0625rem] leading-[1.75] text-reading';

export interface CampaignStoryProps {
  readonly story: StoryDocument;
  readonly title: string;
  /** The two fixed phrases, resolved by the caller — see {@link CampaignStoryCopy}. */
  readonly copy: CampaignStoryCopy;
}

export function CampaignStory({ story, title, copy }: CampaignStoryProps) {
  return (
    <section aria-labelledby="campaign-story" className="rounded-xl bg-surface-2 p-6 sm:p-10">
      {/*
        A heading the page's outline needs and the design does not show. The story is the
        page's main content and the campaign's title above it is the `<h1>`; without this
        the reader's `<h2>`s would hang off nothing, and a screen-reader user navigating by
        heading would find the story's sections with no idea what they belong to.
      */}
      <h2 id="campaign-story" className="sr-only">
        {fillPlaceholders(copy.about, { title })}
      </h2>
      <div className={MEASURE}>
        {story.blocks.map((block, index) => (
          <Block key={index} block={block} watchOn={copy.watchOn} />
        ))}
      </div>
    </section>
  );
}

function Block({ block, watchOn }: { block: StoryBlock; watchOn: string }): ReactNode {
  switch (block.type) {
    case 'heading':
      /*
       * `<h2>` and `<h3>`, never `<h1>`. The campaign's title is the page's one `<h1>`, and
       * a story that opened with a second would give a screen-reader user two documents in
       * one page. #35's editor offers levels 2 and 3 for the same reason, and the `id` is
       * the anchor it generated — unique across the document, because it ends up in a URL.
       */
      return block.level === 2 ? (
        <h2
          id={block.id}
          className="mt-10 mb-4 scroll-mt-24 text-2xl font-semibold tracking-[-0.02em] text-white first:mt-0"
        >
          {block.text}
        </h2>
      ) : (
        <h3
          id={block.id}
          className="mt-8 mb-3 scroll-mt-24 text-xl font-medium tracking-[-0.02em] text-white first:mt-0"
        >
          {block.text}
        </h3>
      );

    case 'paragraph':
      return (
        <p className={`mb-6 last:mb-0 ${BODY}`}>
          <Spans spans={block.spans} />
        </p>
      );

    case 'list':
      return block.ordered ? (
        <ol className={`mb-6 list-decimal space-y-2 pl-6 ${BODY}`}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Spans spans={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className={`mb-6 list-disc space-y-2 pl-6 ${BODY}`}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Spans spans={item} />
            </li>
          ))}
        </ul>
      );

    case 'quote':
      /*
       * A lime rule and not a lime surface. §2.3 allows lime as a border, and a pull quote
       * is emphasis rather than urgency — a lime block here would say "act now" about a
       * sentence somebody is quoting.
       */
      return (
        <blockquote className={`mb-6 border-l-2 border-lime-700 pl-5 italic ${BODY}`}>
          <Spans spans={block.spans} />
        </blockquote>
      );

    case 'rule':
      return <hr className="my-10 border-white/8" />;

    case 'image':
      return (
        <div className="mb-6">
          {/*
            The intrinsic size rather than a crop token: a story image is shown whole,
            because it illustrates something specific and a 16:9 cut through it may remove
            the part that mattered. The frame still reserves the box, so the paragraph below
            does not jump when the picture decodes.

            `alt` is the creator's own, never invented and never empty — `IMAGE_ALT_REQUIRED`
            is why the editor refuses a story image without one.
          */}
          <MediaFrame ratio={{ width: block.width, height: block.height }} radius="md">
            <Image
              src={block.url}
              alt={block.alt}
              fill
              sizes="(min-width: 768px) 68ch, 100vw"
              /*
               * An address on a host the optimiser will not fetch is served as it is rather
               * than thrown over: a raised render in a Server Component takes the whole page
               * down, and one image in one story must not be able to do that.
               */
              unoptimized={!canOptimise(block.url)}
              className="object-cover"
            />
          </MediaFrame>
        </div>
      );

    case 'embed':
      /*
       * A LINK, NOT AN IFRAME, and that is a decision rather than a gap. An `<iframe>` to
       * YouTube on the origin that holds the session cookie is a third party's script with
       * a view of this page, and it costs several hundred kilobytes before anybody presses
       * play — which is exactly what the First Load JS budget in CI exists to notice. A
       * facade that loads the player on click is the right answer and is a client component
       * with a budget of its own; until it exists, the honest rendering is the address the
       * creator gave, with the title they wrote.
       */
      return (
        <p className="mb-6">
          <a
            href={block.url}
            rel="noopener noreferrer nofollow"
            target="_blank"
            className={`rounded-sm text-white underline underline-offset-4 hover:text-lime-400 ${BODY}`}
          >
            {block.title}
            {/* Outside the span, so the link's accessible name keeps the space (#155). */}{' '}
            <span className="text-white/64">
              {fillPlaceholders(watchOn, {
                // The service's names, which are brands and are not translated.
                provider: block.provider === 'youtube' ? 'YouTube' : 'Vimeo',
              })}
            </span>
          </a>
        </p>
      );
  }
}

/**
 * Inline marks, as elements.
 *
 * `<strong>` and `<em>` rather than `<b>` and `<i>`: the document's marks are called
 * `strong` and `em` because that is what a creator meant by them, and the semantic elements
 * are the ones a screen reader announces differently.
 */
function Spans({ spans }: { spans: StorySpans }): ReactNode {
  return spans.map((span, index) => {
    let node: ReactNode = span.text;
    if (span.marks.includes('em')) node = <em>{node}</em>;
    if (span.marks.includes('strong')) node = <strong className="font-semibold text-white">{node}</strong>;
    return <span key={index}>{node}</span>;
  });
}
