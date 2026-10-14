import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

/**
 * No component speaks English of its own — issue #462.
 *
 * <h2>Why a test, and why this one</h2>
 *
 * Every surface on #78's list was translated, and every one of them was found by reading.
 * Closing it took fifty-two strings out of the campaign editor alone, and nothing stopped the
 * fifty-third from landing the next day. `accessible-names.test.ts` guards the names only a
 * screen reader hears; this guards the words everybody sees. It is the web's counterpart of the
 * app's `src/lib/no-literal-prose.test.ts` (#150).
 *
 * <h2>Parsed, not matched</h2>
 *
 * Like its neighbour it reads the source rather than rendering it: a literal is a property of
 * the file. Unlike its neighbour it parses, because a regex cannot tell JSX text from a comment,
 * a class string or a string in a type. The parser is `@babel/parser` rather than the
 * TypeScript compiler API the issue named: this workspace builds with TypeScript 7, whose npm
 * package no longer exposes a parser to JavaScript, and Babel's reads TSX into the same tree
 * shapes without a native binary.
 *
 * <h2>What fails</h2>
 *
 * Every non-test `.tsx` and every `use…` hook `.ts` under `src/components` and `src/app` is
 * read, and it fails on:
 *
 * 1. a JSX text node with a letter in it — `<p>Nothing you typed has been lost…</p>`;
 * 2. a literal rendered as a JSX child — `{busy ? 'Saving' : copy.save}`, `{n} g`;
 * 3. a literal handed to a prop or property that is drawn on screen — `placeholder`, `title`,
 *    `alt`, `label`, `hint`, `description` — unless it is a lowercase token such as the
 *    `autumn-picks` or `you@example.com` a placeholder shows as an example;
 * 4. a sentence anywhere else — a literal that starts with a capital letter and runs to a second
 *    word, such as `setError('The service could not be reached…')` or a hook's English fallback.
 *
 * Literals are followed through ternaries, `??`, `||`, `&&`, `+`, parentheses and templates, so
 * a fallback cannot slip past. Imports, types, `className`, `cn(…)`, `console.*` and the
 * argument of `new Error(…)` are not read: none of them reaches a reader, and the last is a
 * developer's message that a component replaces with catalogue copy before showing anything.
 *
 * A literal held in a lowercase-first `const` and rendered later is beyond what a syntax scan can
 * prove is prose; that remains for review.
 */

const SOURCE = join(process.cwd(), 'src');
const SCANNED = ['components', 'app'].map((directory) => join(SOURCE, directory));

/** Props and properties whose string value is drawn on screen, so any word in one is prose. */
const DRAWN = new Set(['placeholder', 'title', 'alt', 'label', 'hint', 'description']);

/**
 * Files read by nobody's catalogue, on purpose.
 *
 * `global-error.tsx` replaces the root layout when the layout itself failed, so it renders
 * outside the provider and cannot reach a translation (#133).
 */
const ALLOWED_FILES = new Map<string, string>([
  ['app/global-error.tsx', 'renders outside the i18n provider when the root layout fails (#133)'],
]);

/**
 * Literals that are not prose in any language, each with the reason it is here. Keyed by the
 * trimmed text. Adding to this list is a review decision, not a way to make the test pass.
 */
const ALLOWED = new Map<string, string>([
  ['IdeyaNest', 'the brand name, spelled the same in every language'],
  ['© IdeyaNest', 'the copyright line: a symbol and the brand name'],
  ['YouTube', 'a provider’s brand name, offered as a story embed source'],
  ['Vimeo', 'a provider’s brand name, offered as a story embed source'],
  ['/collections/', 'a URL path segment printed in front of a slug field'],
  ['/u/', 'a URL path segment printed in front of a handle field'],
  ['MODERATOR_EMAILS', 'an environment variable’s name, printed as code for an operator'],
  ['ADMINISTER_STAFF', 'a permission’s name, printed as code for an operator'],
  [
    'The platform connects creators with backers. Rewards are not guaranteed, but creators',
    '`TRUST_COPY`, §4.4’s English original kept so a test can hold the catalogue to it; the block draws `campaign.trust.body`',
  ],
  [
    'Two-factor authentication is already enabled.',
    'the service’s refusal, compared with what arrived on the wire and never drawn',
  ],
]);

const LETTER = /\p{L}/u;
/** A catalogue key such as `account.links.saved.label`: dotted, no spaces, never prose. */
const KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_{}]+)+$/u;
/** A lowercase token — a slug, an address, an example value — rather than a word for a reader. */
const TOKEN = /^[\p{Ll}\d][\p{Ll}\d._@/+-]*$/u;
/** A capital, then a second word: how a sentence starts in all four languages. */
const SENTENCE = /^\p{Lu}\p{L}*[’'.,:;!?]?\s+\S*\p{L}/u;

/** Calls whose string arguments never reach a reader. */
const SILENT_CALLEE = /^(?:console\.\w+|cn|clsx|cva|twMerge)$/u;
const ERROR_CLASS = /^(?:Error|TypeError|RangeError|DOMException)$/u;

interface AstNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly loc?: { readonly start: { readonly line: number } } | null;
  readonly [field: string]: unknown;
}

export interface Finding {
  readonly where: string;
  readonly text: string;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function child(node: AstNode, field: string): AstNode | undefined {
  const value = node[field];
  return isNode(value) ? value : undefined;
}

/** The text of a template with each `${…}` as `{}`, which is what the reader would see around it. */
function templateText(node: AstNode): string {
  const quasis = node['quasis'] as readonly AstNode[];
  return quasis.map((quasi) => (quasi['value'] as { cooked: string | null }).cooked ?? '').join('{}');
}

/**
 * The literal text an expression can evaluate to, looking through the shapes copy hides in.
 * A call — `t('key')` above all — is opaque and yields nothing, which is the point.
 */
function literalsIn(node: AstNode | undefined): { node: AstNode; text: string }[] {
  if (node === undefined) return [];
  switch (node.type) {
    case 'StringLiteral':
      return [{ node, text: node['value'] as string }];
    case 'TemplateLiteral':
      return [
        { node, text: templateText(node) },
        ...(node['expressions'] as readonly AstNode[]).flatMap((expression) => literalsIn(expression)),
      ];
    case 'JSXExpressionContainer':
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return literalsIn(child(node, 'expression'));
    case 'ConditionalExpression':
      return [...literalsIn(child(node, 'consequent')), ...literalsIn(child(node, 'alternate'))];
    case 'LogicalExpression':
      return [...literalsIn(child(node, 'left')), ...literalsIn(child(node, 'right'))];
    case 'BinaryExpression':
      return node['operator'] === '+' ? [...literalsIn(child(node, 'left')), ...literalsIn(child(node, 'right'))] : [];
    default:
      return [];
  }
}

/** A JSX attribute's or an object property's name as written; `undefined` for a computed one. */
function nameOf(node: AstNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === 'JSXIdentifier' || node.type === 'Identifier') return node['name'] as string;
  if (node.type === 'StringLiteral') return node['value'] as string;
  return undefined;
}

const NOT_CHILDREN = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens']);

export function proseLiterals(fileName: string, source: string): Finding[] {
  const file = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as AstNode;
  const findings: Finding[] = [];
  // One literal can be reached by two rules: a drawn prop that is also a sentence.
  const seen = new Set<number>();

  const report = (node: AstNode, raw: string): void => {
    const text = raw.trim();
    const start = node.start ?? -1;
    if (seen.has(start)) return;
    seen.add(start);
    if (KEY.test(text) || ALLOWED.has(text)) return;
    findings.push({ where: `${fileName}:${node.loc?.start.line ?? 0}`, text });
  };
  const reportWords = (expression: AstNode | undefined, drawn: boolean): void => {
    for (const found of literalsIn(expression)) {
      const text = found.text.trim();
      if (LETTER.test(text) && !(drawn && TOKEN.test(text))) report(found.node, text);
    }
  };

  const visit = (node: AstNode, parent: AstNode | undefined): void => {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
        return;
      case 'ExportNamedDeclaration':
        if (node['source'] != null) return;
        break;
      case 'JSXText':
        if (LETTER.test(node['value'] as string)) report(node, node['value'] as string);
        return;
      case 'JSXExpressionContainer':
        if (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment') reportWords(child(node, 'expression'), false);
        break;
      case 'JSXAttribute': {
        const name = nameOf(child(node, 'name'));
        if (name === 'className') return;
        if (name !== undefined && DRAWN.has(name)) reportWords(child(node, 'value'), true);
        break;
      }
      case 'ObjectProperty': {
        const name = node['computed'] === true ? undefined : nameOf(child(node, 'key'));
        if (name !== undefined && DRAWN.has(name)) reportWords(child(node, 'value'), true);
        // The key is a name, never prose; only the value is read further.
        const value = child(node, 'value');
        if (value !== undefined) visit(value, node);
        return;
      }
      case 'CallExpression': {
        const callee = child(node, 'callee');
        if (callee !== undefined && SILENT_CALLEE.test(source.slice(callee.start ?? 0, callee.end ?? 0))) return;
        break;
      }
      case 'NewExpression': {
        if (ERROR_CLASS.test(nameOf(child(node, 'callee')) ?? '')) return;
        break;
      }
      case 'StringLiteral':
        if (SENTENCE.test((node['value'] as string).trim())) report(node, node['value'] as string);
        return;
      case 'TemplateLiteral':
        if (SENTENCE.test(templateText(node).trim())) report(node, templateText(node));
        break;
      default:
        // Types say what a value is, never what a reader sees. `x as T` and `x!` are values.
        if (node.type.startsWith('TS') && !node.type.endsWith('Expression')) return;
    }

    for (const [field, value] of Object.entries(node)) {
      if (NOT_CHILDREN.has(field)) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item, node);
      } else if (isNode(value)) {
        visit(value, node);
      }
    }
  };

  visit(file, undefined);
  return findings;
}

/** Every non-test `.tsx`, and every `use…` hook `.ts`, under `directory`. */
function scanned(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scanned(path);
    if (/\.(?:test|stories)\.tsx?$/u.test(entry.name)) return [];
    return entry.name.endsWith('.tsx') || /^use[A-Z]\w*\.ts$/u.test(entry.name) ? [path] : [];
  });
}

const FILES = SCANNED.flatMap(scanned)
  .map((path) => relative(SOURCE, path).split(sep).join('/'))
  .filter((path) => !ALLOWED_FILES.has(path));

describe('literal prose in web components', () => {
  it('finds the files to read, so an empty sweep cannot pass for a clean one', () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  it('finds none: every word a reader sees comes from the catalogue', () => {
    const findings = FILES.flatMap((path) => proseLiterals(path, readFileSync(join(SOURCE, path), 'utf8')));

    expect(
      findings.map(({ where, text }) => `${where}  ${JSON.stringify(text)}`),
      'move these into packages/messages (all four languages), or allow-list a non-prose one with its reason',
    ).toEqual([]);
  });

  it('catches JSX text, drawn props and sentences, and lets keys, tokens and expressions through', () => {
    const source = [
      'const a = <p>Hello there</p>;',
      'const b = <p>{copy.hello}</p>;',
      'const c = <p> · </p>;',
      'const d = <input placeholder="Search projects" />;',
      'const e = <input placeholder="autumn-picks" />;',
      'const f = <img alt={busy ? "Loading" : copy.alt} />;',
      'const g = <Tag>{grams} g</Tag>;',
      'const h = <div className="flex items-center gap-2" title={t("x")} />;',
      'setError("The service could not be reached. Try again.");',
      'const i = cn("Rounded Full", "px-2");',
      'console.error("A page failed to render.");',
      'throw new Error("Apple sign-in did not load.");',
      'import { X } from "Some Module";',
      'type Y = "Not Prose Either";',
      'const j = <Row label="account.links.saved.label" />;',
      'const k = { title: "Language and currency", href: "/settings/language" };',
      'const l = <a>IdeyaNest</a>;',
      'const m = `${count} days left`;',
      'const n = <p>{`Approximately ${amount}`}</p>;',
    ].join('\n');

    expect(proseLiterals('x.tsx', source)).toEqual([
      { where: 'x.tsx:1', text: 'Hello there' },
      { where: 'x.tsx:4', text: 'Search projects' },
      { where: 'x.tsx:6', text: 'Loading' },
      { where: 'x.tsx:7', text: 'g' },
      { where: 'x.tsx:9', text: 'The service could not be reached. Try again.' },
      { where: 'x.tsx:16', text: 'Language and currency' },
      { where: 'x.tsx:19', text: 'Approximately {}' },
    ]);
  });
});
