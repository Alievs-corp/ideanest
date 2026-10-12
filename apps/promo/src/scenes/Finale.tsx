import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { projectCapture } from '../camera';
import { FUNDED_CAMPAIGN, type Copy } from '../copy';
import { Device } from '../device/Device';
import { StillScreen } from '../device/Screen';
import { fontFamily } from '../fonts';
import { Scrim } from '../fx/Scrim';
import { Studio } from '../fx/Studio';
import { point } from '../media';
import { cues, dur, ease, scenes, STAGGER } from '../motion';
import { fundedPose } from '../poses';
import { colors, FRAME, SAFE, TYPE } from '../theme';
import { Headline } from '../text/Headline';
import { CountUp } from '../ui/CountUp';
import { Mark, markDotPosition } from '../ui/Mark';
import { NestRing } from '../ui/NestRing';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const COVER = 2300;

export const MARK_LAYOUT = { x: 540, y: 520, height: 320 } as const;
export const MARK_DOT_AT = markDotPosition(MARK_LAYOUT.x, MARK_LAYOUT.y, MARK_LAYOUT.height);
export const CTA_CENTER: [number, number] = [540, 1330];

export function revealOrigin(): [number, number] {
  return projectCapture(fundedPose(cues.reveal - scenes.funded.start), ...point('fundedProgressEnd'));
}

function Check({ at, size }: { at: number; size: number }) {
  const frame = useCurrentFrame();
  const ring = interpolate(frame - at, [0, 24], [0, 1], { easing: ease.enter, ...clamp });
  const tick = interpolate(frame - at - 10, [0, 18], [0, 1], { easing: ease.move, ...clamp });
  const ink = colors.textOnAccent;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block', margin: '0 auto' }}>
      <circle cx="50" cy="50" r="44" fill="none" stroke={ink} strokeWidth="6" strokeDasharray="276.5" strokeDashoffset={276.5 * (1 - ring)} transform="rotate(-90 50 50)" strokeLinecap="round" />
      <path d="M30 52 L44 65 L71 37" fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="62" strokeDashoffset={62 * (1 - tick)} />
    </svg>
  );
}

function SuccessPanel({ copy, at }: { copy: Copy; at: number }) {
  return (
    <AbsoluteFill style={{ background: colors.success }}>
      <div style={{ position: 'absolute', top: 470, left: 0, right: 0 }}>
        <Check at={at + 12} size={170} />
      </div>
      <Headline lines={[copy.funded]} at={at + 26} top={720} size={TYPE.headlineLarge} align="center" color={colors.textOnAccent} />
      <Headline lines={copy.fundedLine} at={at + 38} top={900} size={64} weight={600} align="center" color={colors.textOnAccent} />
    </AbsoluteFill>
  );
}

export function Funded({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const start = scenes.funded.start;
  const reveal = cues.reveal - start;
  const [ox, oy] = revealOrigin();
  const radius = interpolate(frame - reveal, [0, dur.radialReveal], [0, COVER], { easing: ease.move, ...clamp });
  const countAt = cues.countUp - start;
  return (
    <>
      <Studio />
      <Device pose={fundedPose(frame)} sweepAt={20} screen={<StillScreen id="funded" />} />
      <Scrim opacity={interpolate(frame - countAt, [0, 12], [0, 1], clamp)} height={760} />
      <div
        style={{
          position: 'absolute',
          top: SAFE.top + 10,
          left: SAFE.side,
          right: SAFE.side,
          fontFamily,
          color: colors.textPrimary,
          opacity: interpolate(frame - countAt, [0, 9], [0, 1], clamp),
          transform: `translateY(${interpolate(frame - countAt, [0, dur.textLine], [30, 0], { easing: ease.enter, ...clamp })}px)`,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: TYPE.headline, lineHeight: TYPE.leading, letterSpacing: TYPE.tracking }}>
          <CountUp amount={FUNDED_CAMPAIGN.amount} currency={FUNDED_CAMPAIGN.currency} at={countAt} />
        </div>
        <div style={{ fontWeight: 600, fontSize: TYPE.support, color: colors.textSecondary, marginTop: 18 }}>
          {copy.raisedLabel} · {FUNDED_CAMPAIGN.backers} {copy.backersLabel}
        </div>
      </div>
      {radius > 0 ? (
        <AbsoluteFill style={{ clipPath: `circle(${radius}px at ${ox}px ${oy}px)` }}>
          <SuccessPanel copy={copy} at={reveal} />
        </AbsoluteFill>
      ) : null}
    </>
  );
}

function Wordmark({ at }: { at: number }) {
  const frame = useCurrentFrame();
  const letters = 'IdeyaNest'.split('');
  return (
    <div
      style={{
        position: 'absolute',
        top: 900,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily,
        fontWeight: 800,
        fontSize: TYPE.headline,
        letterSpacing: TYPE.tracking,
        color: colors.textPrimary,
      }}
    >
      {letters.map((ch, i) => {
        const t = interpolate(frame - at - i * STAGGER, [0, 18], [0, 1], { easing: ease.enter, ...clamp });
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: t,
              transform: `translateX(${(1 - t) * 12}px)`,
              filter: `blur(${(1 - t) * 6}px)`,
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
}

function CtaPill({ copy, at }: { copy: Copy; at: number }) {
  const frame = useCurrentFrame();
  const grow = interpolate(frame - at, [0, dur.ctaGrow], [0, 1], { easing: ease.enter, ...clamp });
  const text = interpolate(frame - at - 9, [0, 12], [0, 1], clamp);
  if (grow <= 0) return null;
  return (
    <div style={{ position: 'absolute', top: CTA_CENTER[1] - 66, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          height: 132,
          padding: '0 72px',
          borderRadius: 66,
          background: colors.lime500,
          boxShadow: `0 0 90px 10px ${colors.limeGlow}`,
          display: 'flex',
          alignItems: 'center',
          fontFamily,
          fontWeight: 800,
          fontSize: 54,
          letterSpacing: TYPE.tracking,
          color: colors.textOnLime,
          transform: `scaleX(${0.12 + 0.88 * grow}) scaleY(${0.3 + 0.7 * grow})`,
          opacity: Math.min(1, grow * 3),
        }}
      >
        <span style={{ opacity: text }}>{copy.cta}</span>
      </div>
    </div>
  );
}

export function Brand({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const base = scenes.return.start;
  const rel = (cue: number) => cue - base;
  const [ox, oy] = revealOrigin();
  const shrink = interpolate(frame, [0, 36], [1, 0], { easing: ease.exit, ...clamp });
  const cx = ox + (FRAME.width / 2 - ox) * (1 - shrink);
  const cy = oy + (FRAME.height / 2 - oy) * (1 - shrink);
  const successFade = interpolate(frame, [0, 10], [1, 0], clamp);
  const urlAt = rel(cues.url);
  return (
    <>
      <Studio />
      {shrink > 0 ? (
        <AbsoluteFill style={{ clipPath: `circle(${shrink * COVER}px at ${cx}px ${cy}px)`, background: colors.success }}>
          <AbsoluteFill style={{ opacity: successFade }}>
            <SuccessPanel copy={copy} at={-200} />
          </AbsoluteFill>
        </AbsoluteFill>
      ) : null}
      {frame < rel(cues.collapse) + 32 ? (
        <NestRing cx={540} cy={960} radius={300} size={96} start={36} collapseAt={rel(cues.collapse)} />
      ) : null}
      <Mark
        x={MARK_LAYOUT.x}
        y={MARK_LAYOUT.y}
        height={MARK_LAYOUT.height}
        color={colors.textPrimary}
        revealAt={rel(cues.markReveal)}
        dotFrom={rel(cues.wordmark)}
      />
      <Wordmark at={rel(cues.wordmark)} />
      <Headline
        lines={[copy.url]}
        at={urlAt}
        top={1040}
        size={TYPE.support}
        weight={600}
        align="center"
        color={colors.textSecondary}
        style={{ letterSpacing: '0.01em' }}
      />
      <CtaPill copy={copy} at={rel(cues.cta)} />
    </>
  );
}

