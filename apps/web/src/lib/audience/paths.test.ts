import { describe, expect, it } from 'vitest';
import { audienceClickAttributes, countsAsVisit, surfaceOf } from './paths';

// Paths as `i18n/navigation`'s `usePathname` returns them: without the language.
describe('countsAsVisit', () => {
  it.each([
    '/',
    '/discover',
    '/projects/sound-lab/a-field-recorder',
    '/projects/sound-lab/a-field-recorder/back',
    '/u/sound-lab',
    '/account/saved',
    // A creator slug that happens to start like a back-office word is still a campaign.
    '/projects/administrators/new-album',
    '/projects/sound-lab/dashboards-for-makers',
  ])('counts %s', (path) => {
    expect(countsAsVisit(path)).toBe(true);
  });

  it.each([
    '/admin',
    '/admin/audience',
    '/projects/0193a3b4/dashboard',
    '/projects/0193a3b4/dashboard/charts',
    '/projects/0193a3b4/edit/story',
    '/projects/new',
  ])('leaves out the back office: %s', (path) => {
    expect(countsAsVisit(path)).toBe(false);
  });
});

describe('the click attributes', () => {
  it('carry the campaign and the listing', () => {
    expect(audienceClickAttributes('p-1', 'COLLECTION')).toEqual({
      'data-audience-project': 'p-1',
      'data-audience-surface': 'COLLECTION',
    });
  });

  it('read an unrecognised listing back as OTHER rather than a request the service refuses', () => {
    expect(surfaceOf('PROFILE')).toBe('PROFILE');
    expect(surfaceOf('FEED')).toBe('OTHER');
    expect(surfaceOf(null)).toBe('OTHER');
  });
});
