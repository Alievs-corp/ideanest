import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * No screen speaks English of its own — issue #150.
 *
 * Every word the reader sees or hears comes from the shared catalogue through `useT()`, so
 * the four languages cannot drift apart screen by screen. A review catches a literal once;
 * this catches the next one. It parses every `.tsx` under `src/app` and `src/components`
 * with the TypeScript compiler (a regex cannot tell JSX text from a comment or a string in
 * a type) and fails on:
 *
 * - a JSX text child that still contains a letter after trimming — `<Text>Saved</Text>`,
 *   but not `<Text>{t('saved')}</Text>` and not punctuation such as `›` or `·`;
 * - a string literal given to a prop a screen reader reads or a screen renders
 *   (`accessibilityLabel`, `accessibilityHint`, `placeholder`, `title`, `label`, and the
 *   header and tab options), whether written `label="Saved"`, `label={'Saved'}` or
 *   `options={{ title: 'Saved' }}`;
 * - the same for the copy-carrying props and properties `text`, `message`, `hint`, `detail`
 *   and `description`, wherever they appear — `accessibilityValue={{ text: '43%' }}`, an
 *   `Alert.alert` button's `{ text: 'Cancel' }` — quoted (`'title':`) or not;
 * - a literal *sentence* (letters and a space) given to any other prop or property inside a
 *   JSX attribute or a call below, since a value with a space in it is copy; a one-word value
 *   there is usually a token (`accessibilityRole="button"`, `style: 'cancel'`) and passes;
 * - the string arguments, and the objects and arrays among them, of `Alert.alert`,
 *   `Alert.prompt`, `announceForAccessibility`, `Share.share` and `ToastAndroid.show*`;
 * - a literal sentence returned from a function in these files (`return 'Try again.'`), which
 *   is how a helper that picks the words for a screen hides them from the rules above.
 *
 * Literals are followed through the shapes copy hides in — `busy ? 'Saving' : 'Save'`,
 * `title ?? 'Untitled'`, `` `${n} days left` `` — so a fallback cannot slip past. A literal
 * held in a `const` and rendered later is beyond what a syntax scan can prove is prose; those
 * are for review.
 */

const ROOT = join(__dirname, '..');
const SCANNED = ['app', 'components'].map((dir) => join(ROOT, dir));

/**
 * Props whose string value is shown or spoken, so any letter in one is prose. The header
 * and tab options are here too because they reach the screen through an options object
 * (`<Stack.Screen options={{ title: 'Share' }} />`) rather than through a JSX attribute.
 */
const SPOKEN_PROPS = new Set([
  'accessibilityLabel',
  'accessibilityHint',
  'placeholder',
  'title',
  'label',
  'headerTitle',
  'headerBackTitle',
  'tabBarLabel',
  'tabBarAccessibilityLabel',
  'text',
  'message',
  'hint',
  'detail',
  'description',
]);

/** Calls that put their string arguments — and the objects among them — in front of the reader. */
const SPOKEN_CALLS = new Set([
  'Alert.alert',
  'Alert.prompt',
  'AccessibilityInfo.announceForAccessibility',
  'Share.share',
  'ToastAndroid.show',
  'ToastAndroid.showWithGravity',
  'ToastAndroid.showWithGravityAndOffset',
]);

/**
 * Deliberate exceptions, each one a string that is not prose in any language.
 * Keyed by the trimmed text. Empty today: the brand name, too, comes from the catalogue.
 */
const ALLOWED = new Set<string>([]);

const LETTER = /\p{L}/u;
/**
 * A catalogue key such as `account.links.saved.label`, which a screen keeps in a table and
 * passes to `t()` later. Dotted identifiers with no space are never prose.
 */
const KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_{}]+)+$/;
/** A letter and a space: a sentence, whatever prop it was handed to (`detail`, `hint` …). */
const SENTENCE = /(?=.*\p{L})\S\s+\S/u;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

interface Finding {
  readonly where: string;
  readonly text: string;
}

/**
 * The literal text an expression can evaluate to, looking through the shapes copy hides
 * in: `a ? 'Yes' : 'No'`, `title ?? 'Untitled'`, `` `${n} days left` `` and parentheses.
 * A call — `t('key')` above all — is opaque and yields nothing, which is the point.
 */
function literalsIn(node: ts.Node | undefined): { node: ts.Node; text: string }[] {
  if (node === undefined) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [{ node, text: node.text }];
  }
  if (ts.isTemplateExpression(node)) {
    const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('{}');
    return [{ node, text }, ...node.templateSpans.flatMap((span) => literalsIn(span.expression))];
  }
  if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) return literalsIn(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalsIn(node.whenTrue), ...literalsIn(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      kind === ts.SyntaxKind.PlusToken
    ) {
      return [...literalsIn(node.left), ...literalsIn(node.right)];
    }
  }
  return [];
}

/** A property's name as written, quoted or not; `undefined` for a computed one. */
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function isSpoken(name: ts.PropertyName): boolean {
  const text = propertyName(name);
  return text !== undefined && SPOKEN_PROPS.has(text);
}

export function literalProse(fileName: string, source: string): Finding[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  // One literal can be reached by two rules (a spoken property inside an alert's buttons).
  const seen = new Set<number>();
  const at = (node: ts.Node) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    return `${fileName}:${line + 1}`;
  };
  const report = (node: ts.Node | undefined, rule: RegExp) => {
    for (const found of literalsIn(node)) {
      const text = found.text.trim();
      const start = found.node.getStart(file);
      if (seen.has(start) || !rule.test(text) || KEY.test(text) || ALLOWED.has(text)) continue;
      seen.add(start);
      findings.push({ where: at(found.node), text });
    }
  };
  /**
   * Into the object and array literals a JSX attribute or a spoken call is handed: a spoken
   * property's value is held to the letter rule, any other property's to the sentence rule.
   */
  const reportDeep = (node: ts.Node | undefined, rule: RegExp): void => {
    if (node === undefined) return;
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) {
      reportDeep(node.expression, rule);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          reportDeep(property.initializer, isSpoken(property.name) ? LETTER : SENTENCE);
        }
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) reportDeep(element, rule);
    } else {
      report(node, rule);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (LETTER.test(text) && !ALLOWED.has(text)) findings.push({ where: at(node), text });
    } else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      // A child: `<Text>{busy ? 'Saving' : 'Save'}</Text>`.
      report(node.expression, LETTER);
    } else if (ts.isJsxAttribute(node)) {
      reportDeep(node.initializer, SPOKEN_PROPS.has(node.name.getText(file)) ? LETTER : SENTENCE);
    } else if (ts.isPropertyAssignment(node) && isSpoken(node.name)) {
      report(node.initializer, LETTER);
    } else if (ts.isCallExpression(node) && SPOKEN_CALLS.has(node.expression.getText(file))) {
      for (const argument of node.arguments) reportDeep(argument, LETTER);
    } else if (ts.isReturnStatement(node)) {
      report(node.expression, SENTENCE);
    } else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      report(node.body, SENTENCE);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

describe('literal prose in screens and components', () => {
  it('finds none: every visible or spoken word comes from the catalogue', () => {
    const findings = SCANNED.flatMap(tsxFiles).flatMap((path) =>
      literalProse(relative(ROOT, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')),
    );
    expect(findings.map(({ where, text }) => `${where}  ${JSON.stringify(text)}`)).toEqual([]);
  });

  it('catches JSX text and spoken props, and lets expressions and punctuation through', () => {
    const source = [
      'const a = <Text>Saved</Text>;',
      'const b = <Text>{t("saved")}</Text>;',
      'const c = <Text> › </Text>;',
      'const d = <Pressable accessibilityLabel="Close" />;',
      'const e = <Pressable accessibilityLabel={t("close")} />;',
      'const f = <Field label={"Email"} placeholder={`you@x`} />;',
      'const g = <View testID="saved-list" />;',
      'const h = <Text>Ə</Text>;',
    ].join('\n');
    expect(literalProse('x.tsx', source)).toEqual([
      { where: 'x.tsx:1', text: 'Saved' },
      { where: 'x.tsx:4', text: 'Close' },
      { where: 'x.tsx:6', text: 'Email' },
      { where: 'x.tsx:6', text: 'you@x' },
      { where: 'x.tsx:8', text: 'Ə' },
    ]);
  });

  it('follows literals through fallbacks, ternaries, templates, options and alerts', () => {
    const source = [
      'const a = <Text>{title ?? "Untitled"}</Text>;',
      'const b = <Text>{busy ? t("saving") : "Save"}</Text>;',
      'const c = <Bar label={`Progress for ${title}`} />;',
      'const d = <State detail="Nothing here yet." role="alert" />;',
      'const e = <Stack.Screen options={{ title: "Back" }} />;',
      'Alert.alert("Sign out?");',
      'const f = <Row label="account.links.saved.label" />;',
      'const g = <Text>{`${count}%`}</Text>;',
      'Alert.alert(t("title"), t("body"), [{ text: "Cancel", style: "cancel" }]);',
      'const h = <View accessibilityValue={{ "text": "43 percent", now: 43 }} />;',
      'Share.share({ message: "Look at this", url });',
      'ToastAndroid.show("Saved", ToastAndroid.SHORT);',
      'function why() { return "That did not work."; }',
      'function key() { return "mobile.lock.face"; }',
      'const route = () => "settings";',
    ].join('\n');
    expect(literalProse('y.tsx', source)).toEqual([
      { where: 'y.tsx:1', text: 'Untitled' },
      { where: 'y.tsx:2', text: 'Save' },
      { where: 'y.tsx:3', text: 'Progress for {}' },
      { where: 'y.tsx:4', text: 'Nothing here yet.' },
      { where: 'y.tsx:5', text: 'Back' },
      { where: 'y.tsx:6', text: 'Sign out?' },
      { where: 'y.tsx:9', text: 'Cancel' },
      { where: 'y.tsx:10', text: '43 percent' },
      { where: 'y.tsx:11', text: 'Look at this' },
      { where: 'y.tsx:12', text: 'Saved' },
      { where: 'y.tsx:13', text: 'That did not work.' },
    ]);
  });
});
