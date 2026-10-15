import { HeroLoop } from './HeroLoop';

/**
 * The home page hero's scene — issues #337 and #490: people walking in from every side to an
 * idea, which grows with each of them.
 *
 * <h2>A video, not live CSS</h2>
 *
 * The picture is `HeroSceneDrawing`, rendered frame by frame into three silent 6.4 s loops: a
 * 1200 × 1080 one for a desktop, 960 × 864 for a tablet and a 720 × 720 square for a phone,
 * 165 to 300 KB each in H.264. As live CSS it was about sixty compositor animations, which held
 * a laptop's frame rate and fell to about 25 frames a second under a 4× CPU slowdown — a
 * phone. A video is decoded by the phone's own hardware.
 *
 * The scene is `aria-hidden` decoration either way; the caption, and on a phone the standfirst,
 * say the same thing as text.
 */

const BASE = '/hero/v1';

const LOOP = {
  desktop: `${BASE}/hero-scene-desktop.mp4`,
  tablet: `${BASE}/hero-scene-tablet.mp4`,
  phone: `${BASE}/hero-scene-phone.mp4`,
  desktopPoster: `${BASE}/hero-scene-desktop.webp`,
  phonePoster: `${BASE}/hero-scene-phone.webp`,
} as const;

const WIDE_SOURCES = [{ media: '(min-width: 1280px)', src: LOOP.desktop }, { src: LOOP.tablet }] as const;
const PHONE_SOURCES = [{ src: LOOP.phone }] as const;

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
          poster={LOOP.desktopPoster}
          className="absolute top-0 left-1/2 aspect-[10/9] h-full w-auto max-w-none -translate-x-1/2 object-cover"
        />
      </div>

      <figcaption className="mt-2 max-w-[40ch] text-center text-[15px] text-white/64">{caption}</figcaption>
    </figure>
  );
}

/**
 * The same scene on a phone, as a square card. The hero's informational lines play over it one
 * at a time, each fading up in and out, one every 3.2 s: two loops of the scene for the four of
 * them. They are decoration here too — the page carries the same words as text for a screen
 * reader — and under reduced motion only the last one stands, over the poster. Its side is
 * capped by the screen's height, so the two actions below it are still on the first screen,
 * above the WhatsApp launcher.
 */
export function HeroPhoneScene({ lines }: { readonly lines: PhoneLines }) {
  return (
    <div
      aria-hidden="true"
      className="@container relative mx-auto aspect-square w-[clamp(220px,calc(100svh-420px),100%)] max-w-[420px] overflow-hidden rounded-xl border border-white/8 bg-surface-2"
      data-testid="hero-phone-scene"
    >
      <HeroLoop sources={PHONE_SOURCES} poster={LOOP.phonePoster} className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-linear-to-t from-surface-2 from-35% to-transparent" />
      {lines.map((line, index) => (
        <p
          key={line}
          className={`absolute inset-x-4 bottom-4 m-0 text-center text-base leading-snug @[320px]:inset-x-5 @[320px]:bottom-5 @[320px]:text-lg font-semibold tracking-[-0.01em] text-white opacity-0 motion-safe:animate-[hero-line_12.8s_ease-in-out_infinite] ${index === lines.length - 1 ? 'motion-reduce:opacity-100' : ''}`}
          style={{ animationDelay: `${index * BEAT}s` }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}
