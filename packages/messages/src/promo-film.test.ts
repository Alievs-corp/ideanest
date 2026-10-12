import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './locale';
import { PROMO_FILM_BASE, promoFilm } from './promo-film';

describe('the promo film address', () => {
  it('gives every language a film, a phone cut and a poster from the public media prefix', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const film = promoFilm(locale);
      for (const url of [film.url, film.mobileUrl, film.posterUrl]) {
        expect(url.startsWith(`${PROMO_FILM_BASE}/v`)).toBe(true);
        expect(url).toMatch(/^https:\/\/[^/]+\/media\/promo\//);
      }
      expect(film.mobileUrl).toMatch(/-720\.mp4$/);
      expect(film.posterUrl).toMatch(/\.jpg$/);
    }
  });

  it('serves each language its own cut, and Turkish the English one', () => {
    expect(promoFilm('az').url).toMatch(/-az\.mp4$/);
    expect(promoFilm('en').url).toMatch(/-en\.mp4$/);
    expect(promoFilm('ru').url).toMatch(/-ru\.mp4$/);
    expect(promoFilm('tr').url).toBe(promoFilm('en').url);
  });

  it('describes a vertical 30 second film', () => {
    const film = promoFilm('az');
    expect(film.height / film.width).toBeCloseTo(16 / 9, 5);
    expect(film.durationMs).toBe(30000);
  });
});
