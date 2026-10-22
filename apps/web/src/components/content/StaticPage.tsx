import type { ReactNode } from 'react';

/**
 * The frame the three static content pages share — §4.13 WS-07, issue #292.
 *
 * <h2>One measure, and it is narrower than the site's</h2>
 *
 * `SiteShell` gives every page 1400 pixels. That is right for a grid of campaign cards and
 * wrong for prose: docs/ui-kit.md §5.4 puts long-form text at a measure a reader's eye can
 * return along, which is roughly 68 characters. The column here is 62ch and the page's own
 * padding does the rest.
 *
 * <h2>`--surface-2` and `--text-reading`, not white on the page ground</h2>
 *
 * §9.2's last prohibition: "set long-form white on pure black" — do not. These are the only
 * pages on the platform with several hundred words of continuous text, so they are the only
 * ones the rule is actually about. The body takes the reading colour and the panel takes the
 * raised surface.
 *
 * <h2>Motion: none, and that is a budget decision rather than a taste one</h2>
 *
 * docs/motion-system.md §5 gives the marketing home **Full**, and it would be defensible to
 * read these three as marketing. `FadeUp` lives behind `@ideanest/ui/motion`, which is 116 kB
 * of animation runtime, and three routes whose entire content is text would each pay it to
 * animate a heading. `packages/ui/README.md` has the measurement; the home page is where that
 * cost buys something.
 */

export interface StaticPageProps {
  readonly title: string;
  /** The sentence under the title. One, and it says what the page is for. */
  readonly summary: string;
  readonly children: ReactNode;
}

export function StaticPage({ title, summary, children }: StaticPageProps) {
  return (
    <article className="mx-auto w-full max-w-[46rem] px-5 py-14 sm:px-6 sm:py-20">
      <header>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 max-w-[56ch] text-lg leading-relaxed text-fg-64">{summary}</p>
      </header>

      {/*
        `[&>*+*]` rather than a margin on every child: these pages are written as a run of
        headings and paragraphs, and putting the rhythm here means the page bodies below stay
        content rather than becoming layout.
      */}
      <div className="mt-12 text-[17px] leading-[1.7] text-reading [&>*+*]:mt-5 [&>h2+p]:mt-3 [&>h2]:mt-12 [&>h2]:text-xl [&>h2]:font-medium [&>h2]:tracking-[-0.02em] [&>h2]:text-fg [&>ul]:flex [&>ul]:list-none [&>ul]:flex-col [&>ul]:gap-3 [&>ul]:border-l [&>ul]:border-fg/8 [&>ul]:pl-5">
        {children}
      </div>
    </article>
  );
}
