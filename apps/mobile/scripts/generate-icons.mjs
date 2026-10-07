#!/usr/bin/env node
/**
 * Generates `src/icons/glyphs.ts` from the Iconsax set — issue #274.
 *
 * Usage: `node scripts/generate-icons.mjs` from `apps/mobile`, after adding a name to
 * `ICONS` or `DERIVED` below. The output is committed; the app never imports
 * `iconsax-react-native` at runtime. It is a devDependency only because it is the
 * maintained MIT packaging of the Iconsax SVG source, and this script reads its drawings.
 *
 * Why generate rather than depend:
 * - the package was last published in 2022 and pulls in `prop-types`;
 * - its components default `color` to a literal and take six variants we do not use;
 * - generating only the names listed here keeps the bundle to the icons the app draws.
 *
 * Licence: Iconsax Free is MIT and free for commercial use inside a product
 * (https://docs.iconsax.io/license-and-terms/license); the React Native packaging is MIT
 * (https://github.com/rendinjast/iconsax-react).
 */
import { createRequire } from 'node:module';
import Module from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The Iconsax names the app uses. Keep sorted. */
const ICONS = [
  'Add',
  'Archive',
  'ArchiveTick',
  'ArrowDown',
  'ArrowDown2',
  'ArrowLeft',
  'ArrowRight',
  'ArrowRight2',
  'ArrowUp',
  'ArrowUp2',
  'Award',
  'Back',
  'Bank',
  'Bookmark',
  'Box',
  'Calendar',
  'CalendarAdd',
  'Camera',
  'Card',
  'Category',
  'Clock',
  'CloudCross',
  'Copy',
  'Crown',
  'Danger',
  'DirectInbox',
  'Discover',
  'DocumentText',
  'Edit2',
  'Element3',
  'EmptyWallet',
  'Export',
  'ExportSquare',
  'Eye',
  'EyeSlash',
  'Filter',
  'FingerScan',
  'Flag',
  'FolderOpen',
  'Gallery',
  'Gift',
  'Global',
  'Heart',
  'HeartTick',
  'Home',
  'Import',
  'InfoCircle',
  'Key',
  'Lamp',
  'Link',
  'Location',
  'Lock',
  'Logout',
  'MagicStar',
  'Message',
  'MessageRemove',
  'Messages2',
  'Minus',
  'Mobile',
  'MoneyRecive',
  'Monitor',
  'More',
  'Notification',
  'NotificationBing',
  'People',
  'ProfileCircle',
  'QuoteUp',
  'Receipt',
  'RecordCircle',
  'Refresh',
  'Scan',
  'SearchNormal1',
  'SearchStatus',
  'Send2',
  'Setting4',
  'Share',
  'ShieldTick',
  'Slash',
  'Sms',
  'SmsSearch',
  'SmsTracking',
  'Sort',
  'Star1',
  'StatusUp',
  'Tag',
  'Task',
  'Text',
  'TextalignLeft',
  'TextBold',
  'TextItalic',
  'TickCircle',
  'Ticket',
  'Timer1',
  'Translate',
  'Trash',
  'Truck',
  'User',
  'UserAdd',
  'UserTick',
  'Verify',
  'VideoPlay',
  'Wallet',
  'Warning2',
  'WifiSquare',
];

/**
 * Glyphs Iconsax does not draw, built from ones it does. Iconsax has no bare cross and no
 * bare tick: a close button and a checkbox need both.
 */
/*
 * A bare mark has no second layer, so its bold and bulk drawings are the same line, heavier. Both
 * are scaled about the centre to the span of a full-grid glyph; the stroke width is divided by the
 * same factor so the drawn line keeps the Iconsax weight.
 */
function bareMark(node, transform, factor) {
  const draw = (strokeWidth) => [
    { el: 'g', attrs: { transform }, children: [{ ...node, attrs: { ...node.attrs, strokeWidth: Math.round((strokeWidth / factor) * 1000) / 1000 } }] },
  ];
  return { linear: draw(1.5), bold: draw(2.25), bulk: draw(2.25) };
}

const DERIVED = {
  /** `Add`'s cross, turned an eighth of the way round and grown to span 6–18 like a full glyph. */
  Close: (get) => {
    const cross = get('Add').linear[0];
    if (cross === undefined) throw new Error('Add no longer has its cross path');
    return bareMark(cross, 'translate(12 12) rotate(45) scale(1.414) translate(-12 -12)', 1.414);
  },
  /** The mark inside `TickCircle`'s linear drawing, without the circle, grown to the full grid. */
  Tick: (get) => {
    const mark = get('TickCircle').linear.find((node) => node.attrs.d?.startsWith('m7.75'));
    if (mark === undefined) throw new Error('TickCircle no longer has the expected tick path');
    return bareMark(mark, 'translate(12 12) scale(1.6) translate(-12 -12)', 1.6);
  },
};

const VARIANTS = { linear: 'Linear', bold: 'Bold', bulk: 'Bulk' };
const COLOUR = 'currentColor';

/*
 * The package's CommonJS modules call `React.createElement` with `react-native-svg`
 * components. Loading them with both stubbed turns each drawing into plain data.
 */
const ELEMENTS = ['Path', 'Circle', 'Rect', 'G', 'Line', 'Ellipse', 'Polygon', 'Polyline'];
const svgStub = Object.fromEntries(ELEMENTS.map((name) => [name, name]));
svgStub.default = 'Svg';
const Fragment = Symbol('Fragment');
const reactStub = {
  Fragment,
  forwardRef: (render) => ({ render }),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
};
reactStub.default = reactStub;
const propTypesStub = new Proxy(() => propTypesStub, { get: () => propTypesStub });

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'react') return reactStub;
  if (request === 'react-native-svg') return svgStub;
  if (request === 'prop-types') return { default: propTypesStub, ...propTypesStub };
  return originalLoad.call(this, request, parent, isMain);
};

const packageDir = dirname(require.resolve('iconsax-react-native/package.json'));

const NUMERIC = new Set(['strokeWidth', 'opacity', 'strokeMiterlimit', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'x2', 'y1', 'y2']);
const DROPPED = new Set(['key', 'xmlns']);

function toNodes(element) {
  if (element === null || element === undefined || element === false) return [];
  if (element.type === Fragment) return element.children.flatMap(toNodes);
  if (typeof element.type === 'function') return toNodes(element.type(element.props));
  if (!ELEMENTS.includes(element.type)) throw new Error(`Unsupported element ${String(element.type)}`);
  const attrs = {};
  for (const [key, value] of Object.entries(element.props)) {
    if (DROPPED.has(key)) continue;
    attrs[key] = NUMERIC.has(key) && typeof value === 'string' ? Number(value) : value;
  }
  const node = { el: element.type.toLowerCase(), attrs };
  const children = element.children.flatMap(toNodes);
  if (children.length > 0) node.children = children;
  return [node];
}

const cache = new Map();
function get(name) {
  if (cache.has(name)) return cache.get(name);
  const component = require(join(packageDir, 'dist', 'cjs', `${name}.js`));
  const glyph = {};
  for (const [key, variant] of Object.entries(VARIANTS)) {
    const svg = component.render({ variant, color: COLOUR, size: 24 }, null);
    if (svg.props.viewBox !== '0 0 24 24') throw new Error(`${name} is not on a 24 grid`);
    glyph[key] = svg.children.flatMap(toNodes);
    if (glyph[key].length === 0) throw new Error(`${name} has no ${variant} drawing`);
  }
  cache.set(name, glyph);
  return glyph;
}

const glyphs = [
  ...ICONS.map((name) => [name, get(name)]),
  ...Object.entries(DERIVED).map(([name, build]) => [name, build(get)]),
].sort(([a], [b]) => a.localeCompare(b));

Module._load = originalLoad;

const body = glyphs
  .map(([name, glyph]) => `export const ${name}: IconGlyph = ${JSON.stringify({ name, ...glyph })};`)
  .join('\n\n');

const output = `/* eslint-disable */
// Generated by scripts/generate-icons.mjs from Iconsax (MIT). Do not edit by hand:
// add the name to the script and run \`node scripts/generate-icons.mjs\`.
import type { IconGlyph } from './types';

${body}
`;

const target = join(here, '..', 'src', 'icons', 'glyphs.ts');
writeFileSync(target, output.replace(/\r?\n/g, '\n'), 'utf8');
console.log(`Wrote ${glyphs.length} glyphs to ${target}`);
