import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
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
import { PERSIST_DELAY_MS } from '../use-autosave';
import { colors, fontSize, lineHeight, radius, spacing } from '../../../theme';
import { useEditor } from '../editor-context';
import { useKeyboardOverlap } from '../keyboard-overlap';
import { useEditorChromeCopy } from '../translator';
import { readHeldStory, storyFingerprint, writeHeldStory, type HeldStory } from './held-story';
import { StoryBlockCard, type MoveDirection, type StoryBlockHandlers } from './story-block-card';
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
 * editor's shared autosave (800ms debounce, sent at once on blur). Moving, adding and removing a
 * block, and the pickers, send at once, having no blur. Risks go as `{risks}`, empty as `null`. A
 * `STORY_DOCUMENT_INVALID` refusal marks the block its `meta.path` names (`rejectedBlockIndex`),
 * and the mark follows that block when it is moved.
 *
 * <h2>A held story</h2>
 *
 * An incomplete block holds the save rather than sending a document the server refuses. The held
 * document exists on this phone and nowhere else, so it is kept OUTSIDE the form, in the editor's
 * store (`held-story.ts`): written after a pause in typing and at once when the app goes to the
 * background or the tab is left, read back when the tab opens again — after a tab switch or after
 * the OS killed the app with the camera open. Once complete it is saved like any change and the
 * held copy is erased. If the service's story changed meanwhile (another device), the tab says so
 * and the creator chooses: keep this phone's version (saved over the other once complete) or use
 * the saved story. Nothing is dropped or overwritten without that choice.
 *
 * <p>Reordering is local: the order is part of the document, so a move is a document change like
 * any other, not a reorder request. It is announced ("Paragraph moved to 3 of 5.") and focus
 * returns, once, to the same button on the moved card.
 *
 * <p>A story written in a newer format than this build reads (`readStoryDocument` refuses it) is
 * shown as a warning with "Reload", read-only, and NEVER autosaved — also when a newer read turns
 * up mid-session: editing it would send back a document with the unknown blocks silently dropped.
 *
 * <p>The draft is seeded once from the project (re-seeding from a save's answer would delete what
 * was typed meanwhile), again in place when the frame bumps `revision`, and after a version is
 * restored. Restoring waits until nothing is on its way to the service, so no older story can land
 * over the restored one.
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

/** Past this font scale the character counter and "Earlier versions" stack (the profile header's threshold). */
const STACK_FONT_SCALE = 1.3;

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

/** What the form starts from: the service's story, or the story this phone was holding back. */
interface Seeded {
  readonly draft: Draft | null;
  /** Fingerprint of the complete story the draft grew from. */
  readonly base: string;
  readonly holding: boolean;
  /** The held story grew from a story the service no longer has. */
  readonly changedElsewhere: boolean;
  /** The service's story, which "Use the saved story" goes back to. */
  readonly server: StoryDocument | null;
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
  const { autosave, online, store, projectId } = editor;
  const vocabulary = story.vocabulary;

  /** `storyProblems`, once per document however many times it is asked. */
  const problemCache = useRef(new WeakMap<StoryDocument, ReadonlyMap<number, string>>());
  const problemsOf = useCallback(
    (document: StoryDocument): ReadonlyMap<number, string> => {
      let found = problemCache.current.get(document);
      if (found === undefined) {
        found = storyProblems(document, vocabulary);
        problemCache.current.set(document, found);
      }
      return found;
    },
    [vocabulary],
  );

  const nextKey = useRef(0);
  const keyFor = useCallback(() => `block-${(nextKey.current += 1)}`, []);
  const withKeys = useCallback((document: StoryDocument): Draft => ({ document, keys: document.blocks.map(() => keyFor()) }), [keyFor]);

  /** The project as the form should start from it: what is held on the phone wins, and says so. */
  const seedFrom = useCallback(
    (project: ProjectEdit): Seeded => {
      const server = documentOf(project);
      if (server === null) return { draft: null, base: '', holding: false, changedElsewhere: false, server };
      const serverPrint = storyFingerprint(server);
      const held: HeldStory | null = readHeldStory(store, projectId);
      if (held !== null) {
        return {
          draft: withKeys(held.document),
          base: held.base,
          holding: true,
          changedElsewhere: held.base !== serverPrint,
          server,
        };
      }
      return { draft: withKeys(server), base: serverPrint, holding: false, changedElsewhere: false, server };
    },
    [store, projectId, withKeys],
  );

  const [initial] = useState(() => seedFrom(seed));
  const [draft, setDraftState] = useState<Draft | null>(initial.draft);
  const [risks, setRisks] = useState(seed.risks ?? '');
  const [changedElsewhere, setChangedElsewhere] = useState(initial.changedElsewhere);
  const serverDocument = useRef(initial.server);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The block just added, whose first field takes focus as it mounts. */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const readOnly = editor.readOnly;

  // Read by the stable handlers the cards hold, so a keystroke in one card re-renders only that card.
  const draftRef = useRef(draft);
  const readOnlyRef = useRef(readOnly);
  const autosaveRef = useRef(autosave);
  const signedOutRef = useRef(editor.load === 'signed-out');
  useEffect(() => {
    readOnlyRef.current = readOnly;
    autosaveRef.current = autosave;
    signedOutRef.current = editor.load === 'signed-out';
  });
  const setDraft = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  /* -------------------------------------------------------------------------------------------
   * The held story, kept outside the form
   * ---------------------------------------------------------------------------------------- */

  /** The complete story the draft last was — what a new hold grows from. */
  const lastComplete = useRef<StoryDocument | null>(initial.holding ? initial.server : initial.draft?.document ?? null);
  const base = useRef(initial.base);
  const holding = useRef(initial.holding);
  /** What is still to be written: a held story, `null` to erase it, `undefined` for nothing. */
  const unwritten = useRef<HeldStory | null | undefined>(undefined);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeHeldNow = useCallback((): void => {
    if (writeTimer.current !== null) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    const pending = unwritten.current;
    unwritten.current = undefined;
    // After a sign-out the store was erased; one account's words are never written back.
    if (pending === undefined || signedOutRef.current) return;
    writeHeldStory(store, projectId, pending);
  }, [store, projectId]);

  useEffect(() => {
    if (draft === null) return; // An unreadable story: what is stored stays as it is.
    if (problemsOf(draft.document).size > 0) {
      if (!holding.current) {
        holding.current = true;
        base.current = storyFingerprint(lastComplete.current ?? emptyStory());
      }
      unwritten.current = { document: draft.document, base: base.current, at: new Date().toISOString() };
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(writeHeldNow, PERSIST_DELAY_MS);
      return;
    }
    lastComplete.current = draft.document;
    if (holding.current) {
      // Complete again: it goes through the autosave like any change, and the held copy goes.
      holding.current = false;
      unwritten.current = null;
      writeHeldNow();
      // Completing it was the choice the warning described: it is saved now, over the other copy.
      setChangedElsewhere(false);
    }
  }, [draft, problemsOf, writeHeldNow]);

  // The background and leaving the tab are when the OS may end the app: write what is held now.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') writeHeldNow();
    });
    return () => {
      subscription.remove();
      writeHeldNow();
    };
  }, [writeHeldNow]);

  /** Forget the held story for good: a restore replaced it, or the creator chose the saved one. */
  const eraseHeld = useCallback((): void => {
    holding.current = false;
    unwritten.current = null;
    writeHeldNow();
  }, [writeHeldNow]);

  /* -------------------------------------------------------------------------------------------
   * Re-seeding when the frame says so
   * ---------------------------------------------------------------------------------------- */

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
    setRisks(next.risks ?? '');
    const document = documentOf(next);
    serverDocument.current = document;
    if (document === null) {
      // A newer format turned up: read-only from here, and nothing held is ever sent over it.
      setDraft(null);
      return;
    }
    const current = draftRef.current;
    if (current === null) {
      // Readable again (Reload): start as the tab does, with anything this phone was holding.
      const seeded = seedFrom(next);
      base.current = seeded.base;
      holding.current = seeded.holding;
      lastComplete.current = seeded.holding ? seeded.server : seeded.draft?.document ?? null;
      setChangedElsewhere(seeded.changedElsewhere);
      setDraft(seeded.draft);
      return;
    }
    if (problemsOf(current.document).size > 0) {
      // Held: it exists only here. Kept, and if the service's story moved meanwhile, said so.
      if (storyFingerprint(document) !== base.current) setChangedElsewhere(true);
      return;
    }
    lastComplete.current = document;
    // The same story read again keeps its cards, so a foreground refetch does not close the keyboard.
    if (storyFingerprint(current.document) === storyFingerprint(document)) return;
    setDraft(withKeys(document));
  }, [editor.revision, problemsOf, seedFrom, setDraft, withKeys]);

  /* -------------------------------------------------------------------------------------------
   * Changing the document
   * ---------------------------------------------------------------------------------------- */

  const commit = useCallback(
    (next: Draft, sendNow = false): void => {
      if (readOnlyRef.current) return;
      setDraft(next);
      // Held while any block is incomplete: the server would refuse it, and the autosave retries
      // the same body — one unfinished description would stop every later save.
      if (problemsOf(next.document).size > 0) return;
      autosaveRef.current.save({ story: next.document });
      if (sendNow) autosaveRef.current.flush();
    },
    [problemsOf, setDraft],
  );

  /** Focus, after the move has rendered, on the same button of the moved card — or its twin at an end. Once. */
  const [focusAfterMove, setFocusAfterMove] = useState<{ key: string; direction: MoveDirection } | null>(null);
  const heads = useRef(new Map<string, View>());
  const buttons = useRef(new Map<string, View>());
  const addHeading = useRef<View>(null);
  useEffect(() => {
    if (focusAfterMove === null) return undefined;
    const timer = setTimeout(() => {
      const keys = draftRef.current?.keys ?? [];
      const index = keys.indexOf(focusAfterMove.key);
      const atEdge = focusAfterMove.direction === 'up' ? index === 0 : index === keys.length - 1;
      const direction = atEdge ? (focusAfterMove.direction === 'up' ? 'down' : 'up') : focusAfterMove.direction;
      focusOn(buttons.current.get(`${focusAfterMove.key}:${direction}`));
      setFocusAfterMove(null);
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusAfterMove]);

  /** After a block is added without text or removed, the screen reader lands on a card's name. */
  const [focusHead, setFocusHead] = useState<{ key: string | null } | null>(null);
  useEffect(() => {
    if (focusHead === null) return undefined;
    const timer = setTimeout(() => {
      focusOn(focusHead.key === null ? addHeading.current : heads.current.get(focusHead.key));
      setFocusHead(null);
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusHead]);

  const add = useCallback(
    (type: StoryBlockType): void => {
      const current = draftRef.current;
      if (current === null || readOnlyRef.current) return;
      const blocks = current.document.blocks;
      const total = blocks.length;
      const headingIds = blocks.flatMap((block) => (block.type === 'heading' ? [block.id] : []));
      const key = keyFor();
      setFocusKey(key);
      commit(
        {
          document: { ...current.document, blocks: insertBlock(blocks, total, newBlock(type, headingIds)) },
          keys: [...current.keys, key],
        },
        true,
      );
      announce(
        fillPlaceholders(story.blocks.addedAnnouncement, {
          label: vocabulary.blockLabel[type],
          position: String(total + 1),
          total: String(total + 1),
        }),
      );
      // A block with no text to type into is focused by its name instead.
      if (type === 'rule' || type === 'image') setFocusHead({ key });
    },
    [commit, keyFor, story.blocks.addedAnnouncement, vocabulary],
  );

  const handlers = useMemo<StoryBlockHandlers>(
    () => ({
      change: (key, block, sendNow) => {
        const current = draftRef.current;
        const index = current?.keys.indexOf(key) ?? -1;
        if (current === null || index < 0) return;
        commit({ document: { ...current.document, blocks: replaceBlock(current.document.blocks, index, block) }, keys: current.keys }, sendNow);
      },
      move: (key, direction) => {
        const current = draftRef.current;
        if (current === null || readOnlyRef.current) return;
        const index = current.keys.indexOf(key);
        const block = current.document.blocks[index];
        const target = direction === 'up' ? index - 1 : index + 1;
        if (block === undefined || target < 0 || target >= current.keys.length) return;
        const keys = [...current.keys];
        keys.splice(index, 1);
        keys.splice(target, 0, key);
        commit({ document: { ...current.document, blocks: moveBlock(current.document.blocks, index, target) }, keys }, true);
        announce(
          fillPlaceholders(story.blocks.movedAnnouncement, {
            label: vocabulary.blockLabel[block.type],
            position: String(target + 1),
            total: String(keys.length),
          }),
        );
        setFocusAfterMove({ key, direction });
      },
      remove: (key) => {
        const current = draftRef.current;
        if (current === null || readOnlyRef.current) return;
        const index = current.keys.indexOf(key);
        const block = current.document.blocks[index];
        if (block === undefined) return;
        const keys = current.keys.filter((other) => other !== key);
        commit({ document: { ...current.document, blocks: removeBlock(current.document.blocks, index) }, keys }, true);
        announce(
          fillPlaceholders(pluralise(locale, story.blocks.removedAnnouncement, keys.length), {
            label: vocabulary.blockLabel[block.type],
            count: String(keys.length),
          }),
        );
        setFocusHead({ key: keys[Math.min(index, keys.length - 1)] ?? null });
      },
      flush: () => autosaveRef.current.flush(),
      takenAnchors: (key) => {
        const current = draftRef.current;
        if (current === null) return [];
        const index = current.keys.indexOf(key);
        return current.document.blocks.flatMap((block, at) => (block.type === 'heading' && at !== index ? [block.id] : []));
      },
      registerHead: (key, node) => {
        if (node === null) heads.current.delete(key);
        else heads.current.set(key, node);
      },
      registerButton: (key, direction, node) => {
        if (node === null) buttons.current.delete(`${key}:${direction}`);
        else buttons.current.set(`${key}:${direction}`, node);
      },
    }),
    [commit, locale, story.blocks.movedAnnouncement, story.blocks.removedAnnouncement, vocabulary],
  );

  const changeRisks = useCallback((next: string): void => {
    if (readOnlyRef.current) return;
    setRisks(next);
    // Cleared is a legitimate edit; the 200 minimum is a submission rule, not a reason to refuse.
    autosaveRef.current.save({ risks: next.trim() === '' ? null : next });
  }, []);

  /* -------------------------------------------------------------------------------------------
   * What the page shows, worked out once per change
   * ---------------------------------------------------------------------------------------- */

  const failure = autosave.failure;
  const fieldErrors = serverErrors(failure);
  const document = draft?.document ?? null;
  /** The block a refusal named, as the card it was — so the mark moves with it, and goes with it. */
  const rejectedKey = useMemo(() => {
    const index = rejectedBlockIndex(failure);
    return index === null ? null : (draftRef.current?.keys[index] ?? null);
  }, [failure]);

  const problems = useMemo(() => {
    const merged = new Map(document === null ? [] : problemsOf(document));
    // The client's rules are for speed; where the server named a block, its words win.
    const index = rejectedKey === null || draft === null ? -1 : draft.keys.indexOf(rejectedKey);
    if (index >= 0 && fieldErrors.story !== undefined) merged.set(index, fieldErrors.story);
    return merged;
  }, [document, draft, problemsOf, rejectedKey, fieldErrors.story]);

  const storyCharacters = useMemo(() => (document === null ? 0 : storyCharacterCount(document)), [document]);
  const anchors = useMemo(() => (document === null ? [] : headingAnchors(document)), [document]);
  const held = document !== null && problemsOf(document).size > 0;

  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const scrolling = useStoryScrollController({ scroll, content });
  // The keyboard shrinks the scroll view by what it covers; the shrink re-places the focused field.
  const keyboard = useKeyboardOverlap();
  const risksBox = useRef<View>(null);
  // A large font stacks the counter over "Earlier versions" instead of squeezing it beside the pill.
  const stackCounter = useWindowDimensions().fontScale > STACK_FONT_SCALE;

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

  const total = document.blocks.length;

  function takeSavedStory(): void {
    const server = serverDocument.current;
    if (server === null) return;
    eraseHeld();
    lastComplete.current = server;
    setChangedElsewhere(false);
    setDraft(withKeys(server));
  }

  function keepThisVersion(): void {
    // The creator chose this phone's version; it now grows from the story the service has.
    const server = serverDocument.current;
    if (server !== null) base.current = storyFingerprint(server);
    if (draftRef.current !== null && holding.current) {
      unwritten.current = { document: draftRef.current.document, base: base.current, at: new Date().toISOString() };
      writeHeldNow();
    }
    setChangedElsewhere(false);
  }

  return (
    <View
      ref={keyboard.ref}
      style={[styles.fill, { paddingBottom: keyboard.overlap }]}
      onLayout={keyboard.onLayout}
      collapsable={false}
      testID="story-keyboard-frame"
    >
      <View style={styles.fill}>
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
            <View ref={content} style={styles.column} collapsable={false} onLayout={scrolling.onContentLayout}>
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

              {changedElsewhere ? (
                <InlineAlert
                  variant="warning"
                  title={t('held.changedTitle')}
                  description={t('held.changedBody')}
                  testID="story-changed-elsewhere"
                  action={
                    <View style={styles.actions}>
                      <Pill
                        label={t('held.keep')}
                        variant="ghost"
                        size="sm"
                        onPress={keepThisVersion}
                        testID="story-held-keep"
                      />
                      <Pill
                        label={t('held.useSaved')}
                        variant="ghost"
                        size="sm"
                        disabled={readOnly}
                        onPress={takeSavedStory}
                        testID="story-held-discard"
                      />
                    </View>
                  }
                />
              ) : null}

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

              <View style={stackCounter ? styles.counterStacked : styles.counter} testID="story-counter">
                <View style={[styles.counterText, stackCounter ? styles.counterTextStacked : styles.counterTextRow]}>
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
                    // What is typed goes first; Restore waits until it has landed.
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
                    {anchors.map((anchor, index) => (
                      // Two headings may share an anchor (the duplicate is the problem shown on it).
                      <View
                        key={`${index}:${anchor.id}`}
                        style={[styles.anchor, anchor.level === 3 && styles.indented]}
                      >
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
                        blockKey={key}
                        copy={copy}
                        block={block}
                        index={index}
                        total={total}
                        disabled={readOnly}
                        problem={problems.get(index) ?? null}
                        autoFocus={focusKey === key}
                        handlers={handlers}
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
                      label={vocabulary.blockLabel[type]}
                      // The action, not the noun: "Paragraph" alone sounds like a heading.
                      accessibilityLabel={fillPlaceholders(story.blocks.addOne, {
                        kind: vocabulary.blockLabel[type].toLocaleLowerCase(locale),
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

              <View ref={risksBox} collapsable={false}>
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
                    onFocus={() => scrolling.value.reveal(risksBox.current)}
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
            </View>
          </ScrollView>
        </StoryScrollProvider>

        <StoryVersionHistory
          visible={historyOpen}
          onClose={() => setHistoryOpen(false)}
          projectId={projectId}
          copy={copy}
          currentCharacters={storyCharacters}
          readOnly={readOnly}
          waiting={autosave.pending}
          discardsHeld={held}
          onRestored={(project) => {
            // The restored story replaces what was held here: nothing of it may come back.
            eraseHeld();
            setHistoryOpen(false);
            onRestored(project);
          }}
        />
      </View>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
  counter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  // A large font: the sentence takes the full width and the pill goes under it.
  counterStacked: { alignItems: 'flex-start', gap: spacing[3] },
  counterText: { gap: spacing[1] },
  // Never narrower than half the row: a pill that does not fit beside it wraps below instead.
  counterTextRow: { flexGrow: 1, flexShrink: 1, minWidth: '50%' },
  counterTextStacked: { alignSelf: 'stretch' },
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
