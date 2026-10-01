import type { ExpoConfig } from 'expo/config';

/**
 * `IDEANEST_REALTIME_ORIGIN`, the third build-time origin (#155).
 *
 * What is pinned: unset means no socket — `undefined`, never a default host — and a value that is
 * set but unusable throws the build, like the other two origins. `app.config.ts` reads the
 * environment once, at import, so each case loads it afresh in an isolated registry.
 */

const VARIABLE = 'IDEANEST_REALTIME_ORIGIN';

function configWith(value: string | undefined): ExpoConfig {
  const previous = process.env[VARIABLE];
  if (value === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = value;
  try {
    let loaded: ExpoConfig | undefined;
    jest.isolateModules(() => {
      loaded = (require('../../app.config') as { default: ExpoConfig }).default;
    });
    if (loaded === undefined) throw new Error('app.config.ts did not load');
    return loaded;
  } finally {
    if (previous === undefined) delete process.env[VARIABLE];
    else process.env[VARIABLE] = previous;
  }
}

describe('IDEANEST_REALTIME_ORIGIN in app.config.ts', () => {
  it('puts nothing in extra when unset, so the build opens no socket', () => {
    expect(configWith(undefined).extra).not.toHaveProperty('realtimeOrigin');
    expect(configWith('   ').extra).not.toHaveProperty('realtimeOrigin');
  });

  it('accepts an http, https, ws or wss origin and trims a trailing slash', () => {
    expect(configWith('https://api.ideyanest.com/').extra?.realtimeOrigin).toBe('https://api.ideyanest.com');
    expect(configWith('http://10.0.2.2:8080').extra?.realtimeOrigin).toBe('http://10.0.2.2:8080');
    expect(configWith('wss://rt.ideyanest.com').extra?.realtimeOrigin).toBe('wss://rt.ideyanest.com');
    expect(configWith('ws://localhost:8080').extra?.realtimeOrigin).toBe('ws://localhost:8080');
  });

  it('throws the build for a value that is set but unusable', () => {
    expect(() => configWith('api.ideyanest.com')).toThrow(/IDEANEST_REALTIME_ORIGIN is not an absolute URL/);
    expect(() => configWith('ftp://api.ideyanest.com')).toThrow(/must be http or https or ws or wss/);
  });
});

describe('realtimeOrigin()', () => {
  const extra = (jest.requireMock('expo-constants') as { default: { expoConfig: { extra: Record<string, unknown> } } })
    .default.expoConfig.extra;

  afterEach(() => {
    delete extra['realtimeOrigin'];
  });

  it('is undefined when the build has none, rather than throwing like apiOrigin()', () => {
    const { realtimeOrigin } = require('./config') as typeof import('./config');
    expect(realtimeOrigin()).toBeUndefined();
    extra['realtimeOrigin'] = '';
    expect(realtimeOrigin()).toBeUndefined();
  });

  it('reads the origin the build was given', () => {
    const { realtimeOrigin } = require('./config') as typeof import('./config');
    extra['realtimeOrigin'] = 'https://api.ideyanest.com';
    expect(realtimeOrigin()).toBe('https://api.ideyanest.com');
  });
});
