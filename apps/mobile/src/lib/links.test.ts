import { destinationFor, shareUrlFor } from './links';

const HOST = 'ideanest.az';

describe('destinationFor', () => {
  it('opens a campaign from a universal link', () => {
    expect(destinationFor('https://ideanest.az/projects/aysel/solar-lamp', HOST)).toEqual({
      pathname: '/projects/aysel/solar-lamp',
    });
  });

  it('opens the same campaign from the custom scheme a push notification uses', () => {
    // The two forms differ by a slash and by an authority; MB-02 (§4.12) exists because
    // they must not differ by a screen.
    expect(destinationFor('ideanest://projects/aysel/solar-lamp', HOST)).toEqual({
      pathname: '/projects/aysel/solar-lamp',
    });
  });

  it('tolerates a trailing slash, which a pasted link often carries', () => {
    expect(destinationFor('https://ideanest.az/projects/aysel/solar-lamp/', HOST)).toEqual({
      pathname: '/projects/aysel/solar-lamp',
    });
  });

  it('decodes a percent-encoded slug exactly once', () => {
    expect(destinationFor('https://ideanest.az/projects/ay%C5%9Fe/l%C3%A2mba', HOST)).toEqual({
      pathname: '/projects/ayşe/lâmba',
    });
  });

  it('refuses a host that merely ends with ours', () => {
    // The reason the check is an equality and not endsWith.
    expect(destinationFor('https://evil-ideanest.az/projects/a/b', HOST)).toBeNull();
  });

  it('refuses a subdomain nobody claimed', () => {
    expect(destinationFor('https://staging.ideanest.az/projects/a/b', HOST)).toBeNull();
  });

  it('refuses plain http even on the right host', () => {
    expect(destinationFor('http://ideanest.az/projects/a/b', HOST)).toBeNull();
  });

  it('ignores case in the host, which a pasted link often changes', () => {
    expect(destinationFor('https://IdeaNest.AZ/projects/a/b', HOST)).toEqual({
      pathname: '/projects/a/b',
    });
  });

  it('answers null for a web page this application does not have', () => {
    // Not the home screen. See the note on why a fallback hides both cases.
    expect(destinationFor('https://ideanest.az/about', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/projects/only-one-segment', HOST)).toBeNull();
  });

  it('answers null for something that is not a URL at all', () => {
    expect(destinationFor('projects/aysel/solar-lamp', HOST)).toBeNull();
    expect(destinationFor('', HOST)).toBeNull();
  });

  it('refuses a deeper path under the campaign prefix', () => {
    // /projects/a/b/edit is a creator screen on the web and does not exist here.
    // Routing it to the campaign would show the wrong thing confidently.
    expect(destinationFor('https://ideanest.az/projects/a/b/edit', HOST)).toBeNull();
  });

  it('never opens the kit gallery, from any form of link (issue #151)', () => {
    // `app/dev/kit.tsx` is a development screen. A link — shared, pushed or crafted — must not
    // be able to reach it, whatever its scheme, host, locale prefix or case.
    const links = [
      'https://ideanest.az/dev/kit',
      'https://ideanest.az/az/dev/kit',
      'https://ideanest.az/dev/kit/',
      'https://IDEANEST.AZ/dev/kit?x=1',
      'ideanest://dev/kit',
      'ideanest:///dev/kit',
      'ideanest://dev/kit/',
      'ideanest://az/dev/kit',
      'https://ideanest.az/%64ev/kit',
    ];
    for (const link of links) {
      // Refused outright: none of these is a campaign, so the parser has nowhere to send it.
      expect(destinationFor(link, HOST)).toBeNull();
    }
    // And a campaign whose creator happens to be called "dev" still opens the campaign, under
    // `/projects/`, never the gallery's route.
    expect(destinationFor('https://ideanest.az/projects/dev/kit', HOST)?.pathname).toBe(
      '/projects/dev/kit',
    );
  });
});

describe('shareUrlFor', () => {
  it('shares the https URL rather than the custom scheme', () => {
    // A recipient without the application installed has to be able to open it.
    expect(shareUrlFor('https://ideanest.az', 'aysel', 'solar-lamp')).toBe(
      'https://ideanest.az/projects/aysel/solar-lamp',
    );
  });

  it('encodes a slug that needs it', () => {
    expect(shareUrlFor('https://ideanest.az', 'ayşe', 'lâmba')).toBe(
      'https://ideanest.az/projects/ay%C5%9Fe/l%C3%A2mba',
    );
  });
});
