import { Fragment, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Glyphs } from '../../icons';
import type { StoryBlock, StoryDocument, StorySpans } from '@ideanest/campaign/story';
import { useT } from '../../lib/i18n';
import {
  colors,
  font,
  fontSize,
  lineHeight,
  radius,
  readingMeasure,
  size,
  spacing,
  tint,
  tracking,
} from '../../theme';
import { toneColor } from '../text';
import { Icon, MediaFrame, PressableScale, TONES, useFocusRing, useSurface } from '../ui';

/**
 * The story — the web's `CampaignStory` (#155, #140), as native text.
 *
 * <h2>The real schema, read by the shared reader</h2>
 *
 * The service stores and sends `{version: 1, blocks: [...]}`. The app's old reader walked a
 * TipTap tree, found nothing on that root, and drew every real story as empty. This one is handed
 * the document `readStoryDocument` (`@ideanest/campaign/story`) accepted — the same function the
 * web validates with — so a story renders on a phone exactly when it renders in a browser, and a
 * document that fails validation (version 2, an unknown block, a malformed span) is no story
 * section at all, on both.
 *
 * <h2>Every block, as `Text`</h2>
 *
 * Headings (level 2 at 24 semibold, level 3 at 20 medium, both `header` to a screen reader),
 * paragraphs with `em` and `strong` spans, ordered and unordered lists, quotes on a lime-700 rule,
 * dividers, images at their own aspect ratio with the creator's `alt` as their name, and embeds.
 * Never HTML and never a WebView: the creator's words are data.
 *
 * <p>Reading text is 17 on 1.75 with a 68-character measure. On the dark canvas it sits on a
 * surface-2 card; inside the page's white content sheet the sheet is the card, and every tone is
 * the sheet's on-white one (`Ink`). No height is fixed and nothing is truncated, so Dynamic Type
 * grows the story rather than clipping it.
 *
 * <h2>Embeds are links out</h2>
 *
 * The web has no player and neither does the app: an embed is "{title} — watch on YouTube", and a
 * tap hands the address to the system (`Linking.openURL`), which opens the YouTube or Vimeo app
 * when it is installed. Only an `http(s)` address is handed over — a story is somebody else's
 * text, and a custom scheme in it is not something to launch on a reader's phone.
 */
export interface CampaignStoryProps {
  readonly story: StoryDocument;
  /** The campaign's title, for the heading a screen reader navigates to ("About {title}"). */
  readonly title: string;
}

export function CampaignStory({ story, title }: CampaignStoryProps) {
  const t = useT('campaign.story');
  const surface = useSurface();
  const ink = inkOf(surface === 'white' ? 'white' : 'dark');
  return (
    <View style={surface === 'white' ? styles.sheet : styles.card} testID="campaign-story">
      {/*
        A heading the outline needs and the design does not show: without it the story's own
        headings hang off nothing for somebody moving by heading.
      */}
      <Text accessibilityRole="header" style={styles.hidden}>
        {t('about', { title })}
      </Text>
      <View style={styles.measure}>
        {story.blocks.map((block, index) => (
          <Block
            key={index}
            block={block}
            ink={ink}
            first={index === 0}
            last={index === story.blocks.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

/** The story's colours on the surface it is drawn on. */
interface Ink {
  readonly reading: string;
  readonly strong: string;
  readonly secondary: string;
  /** The quote's rule: the web's lime-700 on the canvas, a neutral rule on white. */
  readonly quote: string;
  readonly rule: string;
}

function inkOf(surface: 'dark' | 'white'): Ink {
  return surface === 'white'
    ? {
        reading: toneColor('reading', 'white'),
        strong: TONES.white.primary,
        secondary: TONES.white.secondary,
        quote: TONES.white.tertiary,
        rule: tint(colors.black, 0.16),
      }
    : {
        reading: colors.textReading,
        strong: colors.textPrimary,
        secondary: colors.textSecondary,
        quote: colors.lime700,
        rule: colors.border,
      };
}

function Block({
  block,
  ink,
  first,
  last,
}: {
  readonly block: StoryBlock;
  readonly ink: Ink;
  readonly first: boolean;
  /** The last block keeps no space under it; the card's padding is the space. */
  readonly last: boolean;
}): ReactNode {
  const end = last ? styles.last : null;
  switch (block.type) {
    case 'heading':
      return (
        <Text
          accessibilityRole="header"
          style={[
            block.level === 2 ? styles.h2 : styles.h3,
            { color: ink.strong },
            first && styles.first,
          ]}
          testID={`story-heading-${block.level}`}
        >
          {block.text}
        </Text>
      );

    case 'paragraph':
      return (
        <Text style={[styles.paragraph, { color: ink.reading }, end]}>
          <Spans spans={block.spans} ink={ink} />
        </Text>
      );

    case 'list':
      return (
        <View
          style={[styles.list, end]}
          testID={block.ordered ? 'story-ordered' : 'story-unordered'}
        >
          {block.items.map((item, index) => (
            <View key={index} style={styles.item}>
              <Text
                style={[styles.reading, styles.marker, { color: ink.reading }]}
                accessibilityElementsHidden
              >
                {block.ordered ? `${index + 1}.` : '•'}
              </Text>
              <Text style={[styles.reading, styles.itemText, { color: ink.reading }]}>
                <Spans spans={item} ink={ink} />
              </Text>
            </View>
          ))}
        </View>
      );

    case 'quote':
      return (
        <View style={[styles.quote, { borderLeftColor: ink.quote }, end]} testID="story-quote">
          <Text style={[styles.reading, styles.italic, { color: ink.reading }]}>
            <Spans spans={block.spans} ink={ink} />
          </Text>
        </View>
      );

    case 'rule':
      return <View style={[styles.rule, { backgroundColor: ink.rule }, end]} testID="story-rule" />;

    case 'image':
      return (
        <View style={[styles.figure, end]}>
          {/*
            Its own proportions rather than a crop token: a story image illustrates something
            specific, and a 16:9 cut through it may remove the part that mattered. The frame
            still reserves the box so the paragraph below does not jump.
          */}
          <MediaFrame ratio={{ width: block.width, height: block.height }} radius="md">
            <Image
              source={{ uri: block.url }}
              contentFit="cover"
              transition={0}
              style={styles.fill}
              accessible
              accessibilityRole="image"
              accessibilityLabel={block.alt}
              testID="story-image"
            />
          </MediaFrame>
        </View>
      );

    case 'embed':
      return (
        <View style={[styles.embedBlock, end]}>
          <EmbedLink title={block.title} url={block.url} provider={block.provider} ink={ink} />
        </View>
      );
  }
}

/** The services' own names: brands, not words, and the same in every language. */
const PROVIDER_NAMES = { youtube: 'YouTube', vimeo: 'Vimeo' } as const;

function EmbedLink({
  title,
  url,
  provider,
  ink,
}: {
  readonly ink: Ink;
  readonly title: string;
  readonly url: string;
  readonly provider: keyof typeof PROVIDER_NAMES;
}) {
  const t = useT('campaign.story');
  const { ring, onFocus, onBlur } = useFocusRing();
  const suffix = t('watchOn', { provider: PROVIDER_NAMES[provider] });
  const openable = /^https?:\/\//i.test(url);
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={`${title} ${suffix}`}
      disabled={!openable}
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      onFocus={onFocus}
      onBlur={onBlur}
      contentStyle={({ pressed }) => [styles.embed, pressed && styles.pressed, ring]}
      testID="story-embed"
    >
      <Text style={[styles.reading, styles.embedText, { color: ink.reading }]}>
        <Text style={[styles.embedTitle, { color: ink.strong }]}>{title}</Text> {suffix}
      </Text>
      <Icon icon={Glyphs.ExportSquare} size={16} color={ink.secondary} />
    </PressableScale>
  );
}

/** A run of text with its marks: `em` italic, `strong` semibold white — the web's `Spans`. */
function Spans({ spans, ink }: { readonly spans: StorySpans; readonly ink: Ink }) {
  return (
    <>
      {spans.map((span, index) => {
        const em = span.marks.includes('em');
        const strong = span.marks.includes('strong');
        if (!em && !strong) return <Fragment key={index}>{span.text}</Fragment>;
        return (
          <Text
            key={index}
            style={[em && styles.italic, strong && styles.strong, strong && { color: ink.strong }]}
          >
            {span.text}
          </Text>
        );
      })}
    </>
  );
}

const reading = {
  ...font.regular,
  fontSize: fontSize.reading,
  lineHeight: lineHeight.story,
  letterSpacing: tracking.reading,
} as const;

const styles = StyleSheet.create({
  card: { padding: spacing[6], borderRadius: radius.xl, backgroundColor: colors.surface2 },
  // Inside the white content sheet the sheet is the card: no second fill, no second inset.
  sheet: {},
  measure: { maxWidth: readingMeasure },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    color: 'transparent',
  },
  reading,
  paragraph: { ...reading, marginBottom: spacing[6] },
  h2: {
    ...font.semibold,
    fontSize: fontSize.h2,
    lineHeight: lineHeight.h2,
    letterSpacing: tracking.h2,
    marginTop: spacing[10],
    marginBottom: spacing[4],
  },
  h3: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
    marginTop: spacing[8],
    marginBottom: spacing[3],
  },
  first: { marginTop: 0 },
  list: { gap: spacing[2], marginBottom: spacing[6] },
  item: { flexDirection: 'row', gap: spacing[2] },
  marker: { minWidth: spacing[5] },
  itemText: { flex: 1 },
  quote: {
    borderLeftWidth: 2,
    paddingLeft: spacing[5],
    marginBottom: spacing[6],
  },
  italic: { fontStyle: 'italic' },
  strong: { ...font.semibold },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing[10],
  },
  figure: { marginBottom: spacing[6] },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  embed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: size.touchTarget,
    borderRadius: radius.sm,
  },
  embedBlock: { marginBottom: spacing[6] },
  last: { marginBottom: 0 },
  embedText: { flex: 1 },
  embedTitle: { textDecorationLine: 'underline' },
  pressed: { opacity: 0.64 },
});
