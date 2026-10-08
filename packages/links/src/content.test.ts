import { describe, expect, it } from 'vitest';
import { destinationFor } from './destination';

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

  it("opens Pricing, keeping a refused submission's campaign only when it is an id", () => {
    const id = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    expect(destinationFor('https://ideanest.az/az/pricing', HOST)).toEqual({ pathname: '/pricing' });
    expect(destinationFor(`https://ideanest.az/en/pricing?from=submit&project=${id}`, HOST)).toEqual({
      pathname: '/pricing',
      params: { from: 'submit', project: id },
    });
    expect(destinationFor('https://ideanest.az/pricing?from=submit&project=../settings', HOST)).toEqual({
      pathname: '/pricing',
    });
    expect(destinationFor(`https://ideanest.az/pricing?project=${id}`, HOST)).toEqual({ pathname: '/pricing' });
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
