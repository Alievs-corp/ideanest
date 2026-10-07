import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { pluralise } from '@ideanest/messages/plurals';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import {
  RISKS_MIN_CHARACTERS,
  STORY_MIN_CHARACTERS,
  characterCount,
  emptyStory,
  headingAnchors,
  insertBlock,
  moveBlock,
  newBlock,
  readStoryDocument,
  rejectedBlockIndex,
  removeBlock,
  replaceBlock,
  storyCharacterCount,
  storyProblems,
  type StoryBlock,
  type StoryBlockType,
  type StoryDocument,
} from '@ideanest/campaign-editor/story';
import {
  Body,
  Caption,
  CharacterCount,
  Eyebrow,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Subheading,
  Textarea,
  announce,
} from '../../../components/ui';
import { FOCUS_DELAY_MS, focusOn } from '../../../components/ui/overlay';
import { Glyphs } from '../../../icons';
import { formatCount, pluralCategory } from '../../../lib/i18n';
import { colors, fontSize, lineHeight, radius, spacing } from '../../../theme';
import { useEditor } from '../editor-context';
import { useEditorChromeCopy } from '../translator';
import { StoryBlockCard, type MoveDirection } from './story-block-card';
import { useStoryCopy, type StoryCopy } from './story-copy';
import { StoryScrollProvider, useStoryScrollController } from './story-scroll';
import { StoryVersionHistory } from './story-version-history';

/**
 * The Story tab — the web's `StoryPanel` and `StoryBlockEditor`, on a phone (#162).
 *
 * <p>Top to bottom: the autosave failure alert; the "not being saved yet" warning while any block
 * is incomplete; "N of 500 characters needed" with its count and "Earlier versions"; the anchor
 * menu the headings make; the blocks as cards in ONE `ScrollView` (not a virtualised list — a text
 * input inside a recycled cell loses focus); the "Add a block" row; and Risks and challenges.
 *
 * <h2>Saving</h2>
 *
 * There is no save button. The story is saved as ONE document: every change re-checks the blocks
 * with the shared `storyProblems`, and only when there are none is `{story}` queued on the
 * editor's shared autosave (800ms debounce, sent at once on blur). An incomplete block holds the
 * save rather than sending a document the server refuses — the draft is here and the server still
 * has the last story it accepted. Moving, adding and removing a block, and the pickers, send at
 * once, having no blur. Risks go as `{risks}`, empty as `null`. A `STORY_DOCUMENT_INVALID` refusal
 * marks the block its `meta.path` names (`rejectedBlockIndex`).
 *
 * <p>Reordering is local: the order is part of the document, so a move is a document change like
 * any other, not a reorder request. It is announced ("Paragraph moved to 3 of 5.") and focus
 * returns to the same button on the moved card.
 *
 * <p>A story written in a newer format than this build reads (`readStoryDocument` refuses it) is
 * shown as a warning with "Reload", read-only, and NEVER autosaved: editing it would send back a
 * document with the unknown blocks silently dropped.
 *
 * <p>The draft is seeded once from the project (re-seeding from a save's answer would delete what
 * was typed meanwhile), again when the frame bumps `revision`, and after a version is restored.
 */
export function StoryPanel() {
  const editor = useEditor();
  const copy = useStoryCopy();
  const [restored, setRestored] = useState<{ readonly project: ProjectEdit; readonly count: number } | null>(null);

  // Online, never from the cache alone (`canSeed`): a story seeded from a week-old copy would be
  // saved over edits made since. The skeleton stays until the service has answered.
  if (!editor.canSeed || editor.seed === null) {
    return editor.load === 'loading' || editor.load === 'ready' ? <Loading label={copy.story.loadingLabel} /> : null;
  }
  const seed = restored?.project ?? editor.seed;
  return (
    <StoryForm
      key={`${editor.projectId}:${restored?.count ?? 0}`}
      seed={seed}
      copy={copy}
      onRestored={(project) => {
        editor.apply(project);
        setRestored((previous) => ({ project, count: (previous?.count ?? 0) + 1 }));
      }}
    />
  );
}

const LOADING_ROWS = [0, 1, 2];

function Loading({ label }: { readonly label: string }) {
  return (
    <View style={styles.page}>
      <SkeletonGroup label={label} testID="story-loading">
        <View style={styles.column}>
          {LOADING_ROWS.map((row) => (
            <View key={row} style={styles.pair}>
              <Skeleton height={14} width="30%" />
              <Skeleton height={96} radius="lg" />
            </View>
          ))}
        </View>
      </SkeletonGroup>
    </View>
  );
}

/** A 422's `errors` on this tab's two fields. */
function serverErrors(failure: SaveFailure | null): { story?: string; risks?: string } {
  if (failure === null) return {};
  const mapped: { story?: string; risks?: string } = {};
  for (const [key, message] of Object.entries(failure.fieldErrors)) {
    if (key === 'story') mapped.story = message;
    if (key === 'risks') mapped.risks = message;
  }
  return mapped;
}

/** The document to edit, or `null` when this build cannot read the one stored. */
function documentOf(project: ProjectEdit): StoryDocument | null {
  return project.story == null ? emptyStory() : readStoryDocument(project.story);
}

/** The kinds a block can be, in the order the add row offers them, with their glyphs. */
const ADDABLE: readonly { readonly type: StoryBlockType; readonly glyph: typeof Glyphs.Add }[] = [
  { type: 'paragraph', glyph: Glyphs.TextalignLeft },
  { type: 'heading', glyph: Glyphs.Text },
  { type: 'list', glyph: Glyphs.Task },
  { type: 'quote', glyph: Glyphs.QuoteUp },
  { type: 'image', glyph: Glyphs.Gallery },
  { type: 'embed', glyph: Glyphs.VideoPlay },
  { type: 'rule', glyph: Glyphs.Minus },
];

interface Draft {
  readonly document: StoryDocument;
  /** One per block, in the same order: React's identity for a card, which the document has none of. */
  readonly keys: readonly string[];
}

function StoryForm({
  seed,
  copy,
  onRestored,
}: {
  readonly seed: ProjectEdit;
  readonly copy: StoryCopy;
  readonly onRestored: (project: ProjectEdit) => void;
}) {
  const editor = useEditor();
  const chrome = useEditorChromeCopy();
  const insets = useSafeAreaInsets();
  const { story, mobile: t, locale } = copy;
  const { autosave, online } = editor;

  const nextKey = useRef(0);
  const keyFor = useCallback(() => `block-${(nextKey.current += 1)}`, []);
  const [draft, setDraft] = useState<Draft | null>(() => {
    const document = documentOf(seed);
    return document === null ? null : { document, keys: document.blocks.map(() => keyFor()) };
  });
  const [risks, setRisks] = useState(seed.risks ?? '');

  /*
   * Seeded once; again in place when the frame says so (`revision`: an offered change was sent, or
   * a newer copy was read while nothing was waiting). A document held because a block is
   * incomplete is kept: it exists on this phone and nowhere else.
   */
  const seen = useRef(editor.revision);
  const latestSeed = useRef(editor.seed);
  useEffect(() => {
    latestSeed.current = editor.seed;
  }, [editor.seed]);
  useEffect(() => {
    if (seen.current === editor.revision) return;
    seen.current = editor.revision;
    const next = latestSeed.current;
    if (next === null) return;
    setDraft((current) => {
      if (current !== null && storyProblems(current.document, story.vocabulary).size > 0) return current;
      const document = documentOf(next);
      return document === null ? null : { document, keys: document.blocks.map(() => keyFor()) };
    });
    setRisks(next.risks ?? '');
  }, [editor.revision, keyFor, story.vocabulary]);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The block just added, whose first field takes focus as it mounts. */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const readOnly = editor.readOnly;

  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const scrolling = useStoryScrollController({ scroll, content });
  const heads = useRef(new Map<string, View>());
  const buttons = useRef(new Map<string, View>());
  const addHeading = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  const root = useRef<View>(null);

  const failure = autosave.failure;
  const fieldErrors = serverErrors(failure);
  const rejected = rejectedBlockIndex(failure);
  const document = draft?.document ?? null;

  const problems = useMemo(() => {
    const merged = new Map(document === null ? [] : storyProblems(document, story.vocabulary));
    // The client's rules are for speed; where the server named a block, its words win.
    if (rejected !== null && fieldErrors.story !== undefined) merged.set(rejected, fieldErrors.story);
    return merged;
  }, [document, story.vocabulary, rejected, fieldErrors.story]);

  /** Focus, after the move has rendered, on the same button of the moved card — or its twin at an end. */
  const [focusAfterMove, setFocusAfterMove] = useState<{ key: string; direction: MoveDirection; at: number } | null>(null);
  useEffect(() => {
    if (focusAfterMove === null || draft === null) return undefined;
    const timer = setTimeout(() => {
      const index = draft.keys.indexOf(focusAfterMove.key);
      const atEdge = focusAfterMove.direction === 'up' ? index === 0 : index === draft.keys.length - 1;
      const direction = atEdge ? (focusAfterMove.direction === 'up' ? 'down' : 'up') : focusAfterMove.direction;
      focusOn(buttons.current.get(`${focusAfterMove.key}:${direction}`));
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusAfterMove, draft]);

  /** After a block is removed, the screen reader lands on its neighbour rather than nowhere. */
  const [focusHead, setFocusHead] = useState<{ key: string | null; at: number } | null>(null);
  useEffect(() => {
    if (focusHead === null) return undefined;
    const timer = setTimeout(() => {
      focusOn(focusHead.key === null ? addHeading.current : heads.current.get(focusHead.key));
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusHead]);

  if (draft === null || document === null) {
    return (
      <View style={styles.page} testID="story-unreadable">
        <InlineAlert
          variant="warning"
          title={story.readOnlyTitle}
          description={t('unreadableDetail')}
          action={
            <View style={styles.start}>
              <Pill label={story.reload} variant="ghost" size="sm" onPress={editor.reload} testID="story-reload" />
            </View>
          }
        />
      </View>
    );
  }

  function changeDocument(next: Draft, sendNow = false): void {
    if (readOnly) return;
    setDraft(next);
    // Held while any block is incomplete: the server would refuse it, and the autosave retries
    // the same body — one unfinished description would stop every later save.
    if (storyProblems(next.document, story.vocabulary).size > 0) return;
    autosave.save({ story: next.document });
    if (sendNow) autosave.flush();
  }

  function withBlocks(blocks: readonly StoryBlock[], keys: readonly string[]): Draft {
    return { document: { version: document?.version ?? 1, blocks }, keys };
  }

  function add(type: StoryBlockType): void {
    if (draft === null || document === null) return;
    const total = document.blocks.length;
    const headingIds = document.blocks.flatMap((block) => (block.type === 'heading' ? [block.id] : []));
    const key = keyFor();
    setFocusKey(key);
    changeDocument(
      withBlocks(insertBlock(document.blocks, total, newBlock(type, headingIds)), [...draft.keys, key]),
      true,
    );
    announce(
      fillPlaceholders(story.blocks.addedAnnouncement, {
        label: story.vocabulary.blockLabel[type],
        position: String(total + 1),
        total: String(total + 1),
      }),
    );
    // A block with no text to type into is focused by its name instead.
    if (type === 'rule' || type === 'image') setFocusHead({ key, at: Date.now() });
  }

  function move(index: number, direction: MoveDirection): void {
    if (draft === null || document === null) return;
    const block = document.blocks[index];
    const key = draft.keys[index];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (block === undefined || key === undefined || target < 0 || target >= document.blocks.length) return;
    const keys = [...draft.keys];
    keys.splice(index, 1);
    keys.splice(target, 0, key);
    changeDocument(withBlocks(moveBlock(document.blocks, index, target), keys), true);
    announce(
      fillPlaceholders(story.blocks.movedAnnouncement, {
        label: story.vocabulary.blockLabel[block.type],
        position: String(target + 1),
        total: String(document.blocks.length),
      }),
    );
    setFocusAfterMove({ key, direction, at: Date.now() });
  }

  function remove(index: number): void {
    if (draft === null || document === null) return;
    const block = document.blocks[index];
    if (block === undefined) return;
    const keys = draft.keys.filter((_, at) => at !== index);
    const left = document.blocks.length - 1;
    changeDocument(withBlocks(removeBlock(document.blocks, index), keys), true);
    announce(
      fillPlaceholders(pluralise(locale, story.blocks.removedAnnouncement, left), {
        label: story.vocabulary.blockLabel[block.type],
        count: String(left),
      }),
    );
    setFocusHead({ key: keys[Math.min(index, keys.length - 1)] ?? null, at: Date.now() });
  }

  function changeRisks(next: string): void {
    if (readOnly) return;
    setRisks(next);
    // Cleared is a legitimate edit; the 200 minimum is a submission rule, not a reason to refuse.
    autosave.save({ risks: next.trim() === '' ? null : next });
  }

  const storyCharacters = storyCharacterCount(document);
  const anchors = headingAnchors(document);
  const total = document.blocks.length;

  function measureOffset(): void {
    root.current?.measureInWindow((_x, y) => setOffset(y));
  }

  return (
    <View ref={root} style={styles.fill} onLayout={measureOffset} collapsable={false}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // The view starts under the header and the tab row; the keyboard's top is in window terms.
        keyboardVerticalOffset={offset}
      >
        <StoryScrollProvider value={scrolling.value}>
          <ScrollView
            ref={scroll}
            style={styles.fill}
            contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + spacing[8] }]}
            keyboardShouldPersistTaps="handled"
            onScroll={scrolling.onScroll}
            onLayout={(event: LayoutChangeEvent) => scrolling.onLayout(event)}
            scrollEventThrottle={32}
            testID="story-panel"
          >
            <View ref={content} style={styles.column} collapsable={false}>
              {failure === null ? null : (
                <InlineAlert
                  variant="danger"
                  title={story.notSavedTitle}
                  description={failure.message}
                  testID="story-not-saved"
                  action={
                    <View style={styles.failure}>
                      <Caption>{t('notSavedDetail')}</Caption>
                      <View style={styles.start}>
                        <Pill
                          label={chrome.tryAgain}
                          variant="ghost"
                          size="sm"
                          disabled={!online}
                          onPress={autosave.retry}
                          testID="story-retry"
                        />
                      </View>
                    </View>
                  }
                />
              )}

              {problems.size === 0 ? null : (
                <InlineAlert
                  variant="warning"
                  politeness="polite"
                  title={story.notSavingTitle}
                  description={
                    problems.size === 1
                      ? story.notSavingDetail
                      : t(`incomplete.${pluralCategory(locale, problems.size)}`, {
                          count: formatCount(problems.size, locale),
                        })
                  }
                  testID="story-not-saving"
                />
              )}

              <View style={styles.counter}>
                <View style={styles.counterText}>
                  <Caption testID="story-characters">
                    {fillPlaceholders(story.charactersNeeded, {
                      count: formatCount(storyCharacters, locale),
                      min: formatCount(STORY_MIN_CHARACTERS, locale),
                    })}
                  </Caption>
                  <CharacterCount
                    count={Math.min(storyCharacters, STORY_MIN_CHARACTERS)}
                    limit={STORY_MIN_CHARACTERS}
                    announceWithin={STORY_MIN_CHARACTERS}
                  />
                </View>
                <Pill
                  label={story.earlierVersions}
                  iconLeft={Glyphs.Clock}
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    // What is typed goes first, so a restore cannot be overtaken by an older queue.
                    autosave.flush();
                    setHistoryOpen(true);
                  }}
                  testID="story-history-open"
                />
              </View>

              {anchors.length === 0 ? null : (
                <View style={styles.card} testID="story-anchors">
                  <Eyebrow accessibilityRole="header">{story.anchorMenu}</Eyebrow>
                  <View style={styles.anchors}>
                    {anchors.map((anchor) => (
                      <View key={anchor.id} style={[styles.anchor, anchor.level === 3 && styles.indented]}>
                        <Body tone="primary" style={anchor.level === 3 ? styles.small : undefined}>
                          {anchor.text.trim() === '' ? t('untitledSection') : anchor.text}
                        </Body>
                        <Caption tone="tertiary">{`#${anchor.id}`}</Caption>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.blocks}>
                <Subheading accessibilityRole="header">{story.blocks.heading}</Subheading>
                {total === 0 ? (
                  <View style={styles.card} testID="story-empty">
                    <Body>{story.blocks.empty}</Body>
                  </View>
                ) : (
                  document.blocks.map((block, index) => {
                    const key = draft.keys[index] ?? `block-at-${index}`;
                    return (
                      <StoryBlockCard
                        key={key}
                        copy={copy}
                        block={block}
                        index={index}
                        total={total}
                        disabled={readOnly}
                        problem={problems.get(index) ?? null}
                        headingIdsInUse={document.blocks.flatMap((other, at) =>
                          other.type === 'heading' && at !== index ? [other.id] : [],
                        )}
                        autoFocus={focusKey === key}
                        onChange={(next, sendNow) =>
                          changeDocument(withBlocks(replaceBlock(document.blocks, index, next), draft.keys), sendNow)
                        }
                        onMove={(direction) => move(index, direction)}
                        onRemove={() => remove(index)}
                        onFlush={autosave.flush}
                        headRef={(node) => {
                          if (node === null) heads.current.delete(key);
                          else heads.current.set(key, node);
                        }}
                        buttonRef={(direction) => (node) => {
                          if (node === null) buttons.current.delete(`${key}:${direction}`);
                          else buttons.current.set(`${key}:${direction}`, node);
                        }}
                        testID={`story-block-${index}`}
                      />
                    );
                  })
                )}
              </View>

              <View style={styles.card} testID="story-add">
                <View ref={addHeading} accessible accessibilityRole="header">
                  <Eyebrow>{story.blocks.add}</Eyebrow>
                </View>
                <View style={styles.pills}>
                  {ADDABLE.map(({ type, glyph }) => (
                    <Pill
                      key={type}
                      label={story.vocabulary.blockLabel[type]}
                      // The action, not the noun: "Paragraph" alone sounds like a heading.
                      accessibilityLabel={fillPlaceholders(story.blocks.addOne, {
                        kind: story.vocabulary.blockLabel[type].toLocaleLowerCase(locale),
                        hint: type === 'image' ? t('imageHint') : story.blocks.hints[type],
                      })}
                      iconLeft={glyph}
                      variant="ghost"
                      size="sm"
                      disabled={readOnly}
                      onPress={() => add(type)}
                      testID={`story-add-${type}`}
                    />
                  ))}
                </View>
              </View>

              <Field
                label={story.risks}
                required
                hint={fillPlaceholders(story.risksHint, { min: String(RISKS_MIN_CHARACTERS) })}
                error={fieldErrors.risks}
              >
                <Textarea
                  value={risks}
                  placeholder={story.risksPlaceholder}
                  disabled={readOnly}
                  style={styles.risks}
                  onChangeText={changeRisks}
                  onBlur={autosave.flush}
                  testID="story-risks"
                />
                <CharacterCount
                  count={Math.min(characterCount(risks), RISKS_MIN_CHARACTERS)}
                  limit={RISKS_MIN_CHARACTERS}
                  announceWithin={RISKS_MIN_CHARACTERS}
                />
              </Field>
            </View>
          </ScrollView>
        </StoryScrollProvider>

        <StoryVersionHistory
          visible={historyOpen}
          onClose={() => setHistoryOpen(false)}
          projectId={editor.projectId}
          copy={copy}
          currentCharacters={storyCharacters}
          readOnly={readOnly}
          onRestored={(project) => {
            setHistoryOpen(false);
            onRestored(project);
          }}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

/** Six lines of risks at rest: the web's `rows={6}`, from the type scale. */
const RISKS_MIN_HEIGHT = 6 * lineHeight.small + 2 * spacing[3];

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  page: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  column: { gap: spacing[6] },
  pair: { gap: spacing[2] },
  failure: { gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
  counter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  counterText: { flexGrow: 1, flexShrink: 1, gap: spacing[1] },
  card: {
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  anchors: { gap: spacing[2] },
  anchor: { gap: spacing[1] },
  indented: { paddingLeft: spacing[4] },
  small: { fontSize: fontSize.caption, lineHeight: lineHeight.small },
  blocks: { gap: spacing[4] },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  risks: { minHeight: RISKS_MIN_HEIGHT },
});
