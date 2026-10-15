import { describe, expect, it } from 'vitest';
import { PROMO_FILM_BASE } from './promo-film';
import { HERO_LOOP, HERO_LOOP_VERSION } from './hero-loop';

describe('the hero loop addresses', () => {
  it('serves every cut and its poster from a versioned folder under the public media prefix', () => {
    for (const loop of Object.values(HERO_LOOP)) {
      for (const url of [loop.url, loop.posterUrl]) {
        expect(url.startsWith(`${PROMO_FILM_BASE}/hero/v${HERO_LOOP_VERSION}/`)).toBe(true);
        expect(url).toMatch(/^https:\/\/[^/]+\/media\/promo\//);
      }
      expect(loop.url).toMatch(/\.mp4$/);
      expect(loop.posterUrl).toMatch(/\.webp$/);
    }
  });

  it('draws the phone cut square and the wide cuts at the scene ratio', () => {
    expect(HERO_LOOP.phone.width).toBe(HERO_LOOP.phone.height);
    expect(HERO_LOOP.desktop.width / HERO_LOOP.desktop.height).toBeCloseTo(10 / 9, 5);
    expect(HERO_LOOP.tablet.width / HERO_LOOP.tablet.height).toBeCloseTo(10 / 9, 5);
  });
});
