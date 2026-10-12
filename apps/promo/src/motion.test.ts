import { describe, expect, it } from 'vitest';
import timeline from './timeline.json';
import { BAR, BEAT, DURATION, dur, FPS, HALF, scenes, STAGGER } from './motion';

describe('the beat grid', () => {
  it('is 120 BPM at 60 fps: a beat is 30 frames and the film is 15 bars', () => {
    expect(FPS).toBe(60);
    expect(BEAT).toBe(30);
    expect(BAR).toBe(120);
    expect(DURATION / BAR).toBe(15);
    expect(STAGGER).toBe(3);
  });

  it('lays the scenes end to end from the first frame to the last', () => {
    const spans = Object.values(scenes).sort((a, b) => a.start - b.start);
    expect(spans[0]?.start).toBe(0);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]?.start).toBe(spans[i - 1]?.end);
    }
    expect(spans.at(-1)?.end).toBe(DURATION);
  });

  it('starts every scene on a beat', () => {
    for (const span of Object.values(scenes)) {
      expect(span.start % BEAT).toBe(0);
    }
  });

  it('lands every cue on a beat or a half-beat', () => {
    for (const [name, value] of Object.entries(timeline.cues)) {
      for (const frame of [value].flat()) {
        expect(frame % HALF, name).toBe(0);
      }
    }
  });

  it('keeps every sound cue inside the film', () => {
    for (const cue of timeline.sfx) {
      expect(cue.f).toBeGreaterThanOrEqual(0);
      expect(cue.f).toBeLessThan(DURATION);
    }
  });

  it('holds the end card completely still for at least two seconds', () => {
    expect(DURATION - (timeline.cues.cta + dur.ctaGrow)).toBeGreaterThanOrEqual(2 * FPS);
  });

  it('swaps the background no more than twice a second', () => {
    const swaps = timeline.cues.backgroundSwaps;
    for (const at of swaps) {
      expect(swaps.filter((f) => f >= at && f < at + FPS).length).toBeLessThanOrEqual(2);
    }
  });
});
