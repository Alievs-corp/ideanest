import { describe, expect, it } from 'vitest';
import { isMarketPage } from './market';

describe('isMarketPage', () => {
  it('names the pages that list campaigns', () => {
    for (const path of ['/az', '/az/', '/en/discover', '/ru/search', '/tr/categories/games', '/az/collections/spring']) {
      expect(isMarketPage(path), path).toBe(true);
    }
  });

  it('leaves a campaign, a profile and everything without a language alone', () => {
    for (const path of ['/az/projects/1/lamp', '/az/u/someone', '/az/about', '/discover', '/xx/discover']) {
      expect(isMarketPage(path), path).toBe(false);
    }
  });
});
