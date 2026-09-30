/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import config from '../../app.config';
import { font } from './index';

/**
 * Inter is embedded at build time, so the only place a wrong font name shows is a device — as
 * San Francisco or Roboto, silently, on the screen somebody happens to look at (issue #151).
 *
 * This reads the font files the `expo-font` plugin will embed and checks them against what the
 * type roles ask for: the names each platform looks a face up by, the weights, and the letters
 * the four languages need. The same arithmetic a build would do, without a build.
 */

interface FontDefinition {
  readonly path: string;
  readonly weight: number;
}

interface FontPluginProps {
  readonly ios: { readonly fonts: readonly string[] };
  readonly android: {
    readonly fonts: readonly {
      fontFamily: string;
      fontDefinitions: readonly FontDefinition[];
    }[];
  };
}

const entry = config.plugins?.find(
  (plugin): plugin is [string, FontPluginProps] =>
    Array.isArray(plugin) && plugin[0] === 'expo-font',
);

/** Resolved the way the plugin resolves them: as module specifiers from the project root. */
const resolveFrom = createRequire(join(__dirname, '../../package.json'));

describe('the embedded typeface', () => {
  const families = entry?.[1].android.fonts ?? [];
  const paths = families.flatMap(({ fontDefinitions }) => fontDefinitions.map(({ path }) => path));

  it('is registered with the expo-font plugin, one Android family per face', () => {
    expect(entry).toBeDefined();
    // One family per face, not one `Inter` with three weights: below Android 9 React Native
    // rounds 500 and 600 down to regular before asking, and the headings lose their weight.
    expect(families.map(({ fontDefinitions }) => fontDefinitions.length)).toEqual([1, 1, 1]);
  });

  it('embeds the same three files on iOS as on Android', () => {
    expect(entry?.[1].ios.fonts).toEqual(paths);
  });

  /**
   * iOS finds a registered face by its PostScript name and Android by the XML family's name, and
   * both are the same string here. A role asking for `Inter-Medium` when the file calls itself
   * something else falls back to the system font with no error anywhere.
   */
  it.each([
    ['regular', 400],
    ['medium', 500],
    ['semibold', 600],
  ] as const)('gives the %s face a name both platforms resolve, and its weight', (face, weight) => {
    const family = families.find(({ fontFamily }) => fontFamily === font[face].fontFamily);
    const definition = family?.fontDefinitions[0];
    expect(definition?.weight).toBe(weight);

    const names = nameTable(readFileSync(resolveFrom.resolve(definition?.path ?? '')));
    expect(font[face].fontFamily).toBe(names.postScript);
    expect(font[face].fontWeight).toBe(String(weight));
  });

  /**
   * `next/font` loads the `latin-ext` and `cyrillic` subsets on the web for exactly these
   * letters. A face without them draws ə in a fallback font in the middle of an Inter word.
   */
  it.each(paths.map((path) => [path]))('draws Azerbaijani, Turkish and Russian: %s', (path) => {
    const covered = codePoints(readFileSync(resolveFrom.resolve(path)));
    const missing = [...'əƏğĞşŞİıçÇöÖüÜЖжЩщЁёЫы'].filter(
      (letter) => !covered.has(letter.codePointAt(0) ?? 0),
    );

    expect(missing).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * Just enough of the OpenType file format to answer the two questions above
 * ---------------------------------------------------------------------- */

function table(file: Buffer, tag: string): number {
  const count = file.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    if (file.toString('ascii', record, record + 4) === tag) return file.readUInt32BE(record + 8);
  }
  throw new Error(`No ${tag} table`);
}

/** The `name` table's PostScript name (ID 6), from the Windows Unicode records. */
function nameTable(file: Buffer): { postScript: string } {
  const start = table(file, 'name');
  const count = file.readUInt16BE(start + 2);
  const strings = start + file.readUInt16BE(start + 4);

  for (let index = 0; index < count; index += 1) {
    const record = start + 6 + index * 12;
    const platform = file.readUInt16BE(record);
    const nameId = file.readUInt16BE(record + 6);
    if (platform === 3 && nameId === 6) {
      const length = file.readUInt16BE(record + 8);
      const offset = strings + file.readUInt16BE(record + 10);
      let text = '';
      for (let byte = 0; byte < length; byte += 2) {
        text += String.fromCharCode(file.readUInt16BE(offset + byte));
      }
      return { postScript: text };
    }
  }
  throw new Error('No PostScript name');
}

/** Every code point the `cmap` table maps, from its format 4 and format 12 subtables. */
function codePoints(file: Buffer): Set<number> {
  const start = table(file, 'cmap');
  const covered = new Set<number>();

  for (let index = 0; index < file.readUInt16BE(start + 2); index += 1) {
    const subtable = start + file.readUInt32BE(start + 4 + index * 8 + 4);
    const format = file.readUInt16BE(subtable);

    if (format === 4) {
      const segments = file.readUInt16BE(subtable + 6) / 2;
      const ends = subtable + 14;
      const starts = ends + segments * 2 + 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const last = file.readUInt16BE(ends + segment * 2);
        for (
          let point = file.readUInt16BE(starts + segment * 2);
          point <= last && point !== 0xffff;
          point += 1
        ) {
          covered.add(point);
        }
      }
    } else if (format === 12) {
      for (let group = 0; group < file.readUInt32BE(subtable + 12); group += 1) {
        const first = file.readUInt32BE(subtable + 16 + group * 12);
        const last = file.readUInt32BE(subtable + 20 + group * 12);
        for (let point = first; point <= last; point += 1) covered.add(point);
      }
    }
  }
  return covered;
}
