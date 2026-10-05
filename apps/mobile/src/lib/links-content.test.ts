import { destinationFor } from './links';

const HOST = 'ideanest.az';

describe('static and legal links (#164)', () => {
  it.each(['about', 'how-it-works', 'trust-safety', 'legal'])('opens /%s, with or without a locale', (page) => {
    expect(destinationFor(`https://ideanest.az/${page}`, HOST)).toEqual({ pathname: `/${page}` });
    expect(destinationFor(`https://ideanest.az/az/${page}/`, HOST)).toEqual({ pathname: `/${page}` });
    expect(destinationFor(`ideanest://${page}`, HOST)).toEqual({ pathname: `/${page}` });
  });

  it('opens a document in force and an archived version', () => {
    expect(destinationFor('https://ideanest.az/en/legal/terms-of-use', HOST)).toEqual({
      pathname: '/legal/terms-of-use',
    });
    expect(destinationFor('ideanest://legal/creator-agreement/v/3', HOST)).toEqual({
      pathname: '/legal/creator-agreement/v/3',
    });
  });

  it('leaves a document outside the eight, and a version that is not one, to the browser', () => {
    expect(destinationFor('https://ideanest.az/legal/TERMS_OF_USE', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/legal/anything-else', HOST)).toBeNull();
    for (const version of ['0', '07', '100000', 'abc']) {
      expect(destinationFor(`https://ideanest.az/legal/privacy-policy/v/${version}`, HOST)).toBeNull();
    }
    expect(destinationFor('https://ideanest.az/legal/privacy-policy/extra', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/about/team', HOST)).toBeNull();
  });
});
