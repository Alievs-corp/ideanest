import { HERO_LOOP, HERO_LOOP_LIGHT } from '@ideanest/messages/hero-loop';
import { HeroLoop } from './HeroLoop';

/**
 * The home page hero's scene — issues #337 and #490: people walking in from every side to an
 * idea, which grows with each of them.
 *
 * <h2>A video, not live CSS</h2>
 *
 * The picture is `HeroSceneDrawing`, rendered frame by frame into three silent 6.4 s loops: a
 * 1200 × 1080 one for a desktop, 960 × 864 for a tablet and a 720 × 720 square for a phone,
 * 165 to 300 KB each in H.264, served from the media bucket (`@ideanest/messages/hero-loop`).
 *
 * As live CSS it was about sixty compositor animations. On a 390px viewport at device scale 3
 * under a 4× CPU slowdown — a phone — the page ran at about 2.5 frames a second with it, 10 to 14
 * with the video and 17 to 18 with neither. A video is decoded by the phone's own hardware.
 *
 * The scene is `aria-hidden` decoration either way; the caption, and on a phone the standfirst,
 * say the same thing as text.
 */

const WIDE_SOURCES = [
  { media: '(min-width: 1280px)', src: HERO_LOOP.desktop.url },
  { src: HERO_LOOP.tablet.url },
] as const;
const PHONE_SOURCES = [{ src: HERO_LOOP.phone.url }] as const;

const WIDE_SOURCES_LIGHT = [
  { media: '(min-width: 1280px)', src: HERO_LOOP_LIGHT.desktop.url },
  { src: HERO_LOOP_LIGHT.tablet.url },
] as const;
const PHONE_SOURCES_LIGHT = [{ src: HERO_LOOP_LIGHT.phone.url }] as const;

/*
 * ONE LOOP PER THEME, AND CSS PICKS (docs/ui-kit.md §11). The light cut is the same drawing
 * rendered on the light ground. Both are in the markup and the theme hides one, so the server's
 * HTML already shows the right poster — choosing in script would flash the dark scene first on
 * every light page load. The hidden one costs nothing: `HeroLoop` loads its source only once the
 * element intersects the viewport, and a `display: none` element never does.
 */
const DARK_ONLY = 'in-data-[theme=light]:hidden';
const LIGHT_ONLY = 'hidden in-data-[theme=light]:block';

/** One informational line on the phone card every 3.2 s; `hero-line` is written for four. */
const BEAT = 3.2;

type PhoneLines = readonly [string, string, string, string];

export function HeroScene({ caption }: { readonly caption: string }) {
  return (
    <figure className="m-0 hidden w-full flex-col items-center sm:flex">
      <div
        aria-hidden="true"
        className="relative h-[432px] w-full overflow-hidden xl:h-[540px]"
        data-testid="hero-scene"
      >
        <HeroLoop
          sources={WIDE_SOURCES}
          poster={HERO_LOOP.desktop.posterUrl}
          className={`absolute top-0 left-1/2 aspect-[10/9] h-full w-auto max-w-none -translate-x-1/2 object-cover ${DARK_ONLY}`}
        />
        <HeroLoop
          sources={WIDE_SOURCES_LIGHT}
          poster={HERO_LOOP_LIGHT.desktop.posterUrl}
          className={`hero-loop-edge absolute top-0 left-1/2 aspect-[10/9] h-full w-auto max-w-none -translate-x-1/2 object-cover ${LIGHT_ONLY}`}
        />
      </div>

      <figcaption className="mt-2 max-w-[40ch] text-center text-[15px] text-fg-64">{caption}</figcaption>
    </figure>
  );
}

/**
 * The same scene on a phone, as a square card. The hero's informational lines play over it one
 * at a time, each fading up in and out, one every 3.2 s: two loops of the scene for the four of
 * them. They are decoration here too — the page carries the same words as text for a screen
 * reader — and under reduced motion only the last one stands, over the poster. Its side is
 * capped by the screen's height, so the two actions below it are still on the first screen.
 */
export function HeroPhoneScene({ lines }: { readonly lines: PhoneLines }) {
  return (
    <div
      aria-hidden="true"
      className="@container relative mx-auto aspect-square w-[clamp(304px,calc((100svh-420px)*1.38),100%)] max-w-[420px] overflow-hidden rounded-xl border border-fg/8 bg-surface-2"
      data-testid="hero-phone-scene"
    >
      <HeroLoop sources={PHONE_SOURCES} poster={HERO_LOOP.phone.posterUrl} className={`absolute inset-0 size-full object-cover ${DARK_ONLY}`} />
      <HeroLoop
        sources={PHONE_SOURCES_LIGHT}
        poster={HERO_LOOP_LIGHT.phone.posterUrl}
        className={`absolute inset-0 size-full object-cover ${LIGHT_ONLY}`}
      />
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-linear-to-t from-surface-2 from-35% to-transparent" />
      {lines.map((line, index) => (
        <p
          key={line}
          className={`absolute inset-x-4 bottom-4 m-0 text-center text-base leading-snug @[320px]:inset-x-5 @[320px]:bottom-5 @[320px]:text-lg font-semibold tracking-[-0.01em] text-fg opacity-0 motion-safe:animate-[hero-line_12.8s_ease-in-out_infinite] ${index === lines.length - 1 ? 'motion-reduce:opacity-100' : ''}`}
          style={{ animationDelay: `${index * BEAT}s` }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}
