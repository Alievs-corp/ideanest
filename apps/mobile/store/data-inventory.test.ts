import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpoConfig } from 'expo/config';

/**
 * `data-inventory.md` is the table the store forms are answered from, and `ios.privacyManifests`
 * in `app.config.ts` must say the same (#165). This reads the table's "iOS manifest type" column
 * and holds the manifest to it, in a build without a DSN and in one with.
 */

interface Row {
  readonly type: string;
  readonly dsnOnly: boolean;
}

function inventory(): Row[] {
  const lines = readFileSync(join(__dirname, 'data-inventory.md'), 'utf8').split(/\r?\n/);
  const header = lines.findIndex((line) => line.includes('| iOS manifest type |'));
  if (header === -1) throw new Error('data-inventory.md has no "iOS manifest type" column');
  const cells = (line: string) => line.split('|').slice(1, -1).map((cell) => cell.trim());
  const column = cells(lines[header] ?? '').indexOf('iOS manifest type');

  const rows: Row[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    const cell = cells(line)[column] ?? '';
    const type = /^`(\w+)`/.exec(cell)?.[1];
    if (type === undefined) throw new Error(`No manifest type in: ${line}`);
    rows.push({ type, dsnOnly: cell.includes('(DSN only)') });
  }
  return rows;
}

function manifestTypes(dsn: string | undefined): string[] {
  const previous = process.env.IDEANEST_SENTRY_DSN;
  if (dsn === undefined) delete process.env.IDEANEST_SENTRY_DSN;
  else process.env.IDEANEST_SENTRY_DSN = dsn;
  try {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      config = (require('../app.config') as { default: ExpoConfig }).default;
    });
    const manifest = config?.ios?.privacyManifests;
    expect(manifest?.NSPrivacyTracking).toBe(false);
    expect(manifest?.NSPrivacyTrackingDomains).toEqual([]);
    return (manifest?.NSPrivacyCollectedDataTypes ?? []).map((entry) => {
      expect(entry.NSPrivacyCollectedDataTypeLinked).toBe(true);
      expect(entry.NSPrivacyCollectedDataTypeTracking).toBe(false);
      expect(entry.NSPrivacyCollectedDataTypePurposes).toEqual([
        'NSPrivacyCollectedDataTypePurposeAppFunctionality',
      ]);
      return entry.NSPrivacyCollectedDataType.replace(/^NSPrivacyCollectedDataType/, '');
    });
  } finally {
    if (previous === undefined) delete process.env.IDEANEST_SENTRY_DSN;
    else process.env.IDEANEST_SENTRY_DSN = previous;
  }
}

describe('the privacy manifest against data-inventory.md', () => {
  const rows = inventory();

  it('reads a table that has rows, and diagnostics among them', () => {
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.filter((row) => row.dsnOnly).map((row) => row.type)).toEqual([
      'CrashData',
      'PerformanceData',
      'OtherDiagnosticData',
    ]);
  });

  it('declares every always-collected row, and nothing else, in a build without a DSN', () => {
    expect(manifestTypes(undefined).sort()).toEqual(
      rows.filter((row) => !row.dsnOnly).map((row) => row.type).sort(),
    );
  });

  it('declares every row in a build with a DSN', () => {
    expect(manifestTypes('https://key@o1.ingest.de.sentry.io/2').sort()).toEqual(
      rows.map((row) => row.type).sort(),
    );
  });

  it('declares UserDefaults with reason CA92.1', () => {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      config = (require('../app.config') as { default: ExpoConfig }).default;
    });
    expect(config?.ios?.privacyManifests?.NSPrivacyAccessedAPITypes).toContainEqual({
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
    });
  });
});
