import { destinationFor } from './links';

const HOST = 'ideanest.az';
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('pledge links', () => {
  it('opens the list, a pledge and its address, with or without a locale', () => {
    expect(destinationFor('https://ideanest.az/az/pledges', HOST)).toEqual({ pathname: '/pledges' });
    expect(destinationFor(`https://ideanest.az/pledges/${ID}`, HOST)).toEqual({ pathname: `/pledges/${ID}` });
    expect(destinationFor(`https://ideanest.az/en/pledges/${ID}/address/`, HOST)).toEqual({
      pathname: `/pledges/${ID}/address`,
    });
  });

  it('carries only a known payment or raise hint', () => {
    expect(destinationFor(`ideanest://pledges/${ID}?payment=returned`, HOST)).toEqual({
      pathname: `/pledges/${ID}`,
      params: { payment: 'returned' },
    });
    expect(destinationFor(`https://ideanest.az/tr/pledges/${ID}?raise=failed&via=app`, HOST)).toEqual({
      pathname: `/pledges/${ID}`,
      params: { raise: 'failed' },
    });
    expect(destinationFor(`https://ideanest.az/pledges/${ID}?payment=paid`, HOST)).toEqual({
      pathname: `/pledges/${ID}`,
    });
  });

  it('refuses an id that is not a UUID and anything deeper', () => {
    expect(destinationFor('https://ideanest.az/pledges/abc', HOST)).toBeNull();
    expect(destinationFor(`https://ideanest.az/pledges/${ID}/edit`, HOST)).toBeNull();
  });
});
