import { Children, isValidElement, type ReactNode } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { siteUrl } from '../../api/config';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { currentLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { FadeUp } from '../motion';
import { Body, Heading, Story, Subheading } from '../text';
import {
  IconButton,
  Screen,
  TONES,
  announce,
  useSurface,
  type ScreenError,
} from '../ui';

/**
 * The frame the static and legal pages share — the web's `StaticPage.tsx`, issue #164.
 *
 * <h2>Prose on the canvas</h2>
 *
 * The title and its one-sentence summary, then the body: 17pt reading text (`Story`, the
 * `--text-reading` tone the web gives these pages because they are the only long-form white on
 * black on the platform), 20pt between blocks, 48pt above a section heading and 12pt below it, and
 * lists with a hairline rule at their left instead of bullets. Lists of rows — the legal index —
 * sit in a white sheet below instead (`mobile-design` skill §2); prose stays on the canvas, where
 * the reading tone exists.
 *
 * <h2>Header share</h2>
 *
 * Every page sends its https address (`${siteUrl}/${locale}${path}`), which opens the app for
 * somebody who has it and the web page for everybody else; never `ideanest://`.
 *
 * <h2>Motion</h2>
 *
 * The title block rises once (`FadeUp`, the skill's entry for a screen's first screenful). The body
 * does not: these pages are text, and text that moves while somebody starts reading it is the
 * opposite of what a static page is for. Reduce Motion stops the title's rise too.
 */
export interface StaticPageProps {
  readonly title: string;
  /** The sentence under the title. */
  readonly summary: string;
  /** The web path, without the locale, that the header's share action sends (`/about`). */
  readonly sharePath: string;
  readonly children?: ReactNode;
  /** A white sheet of rows under the prose (the legal index), drawn to the foot of the screen. */
  readonly sheet?: ReactNode;
  /** False while the content is loading or failed with nothing cached: `Screen` decides. */
  readonly hasContent?: boolean;
  readonly error?: ScreenError | null;
  readonly offlineNotice?: string | null;
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  /** The native header's title; the page title by default. */
  readonly headerTitle?: string;
  readonly testID?: string;
}

export function StaticPage({
  title,
  summary,
  sharePath,
  children,
  sheet,
  hasContent = true,
  error,
  offlineNotice,
  onRefresh,
  refreshing,
  headerTitle,
  testID,
}: StaticPageProps) {
  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle ?? title,
          headerRight: () => <ShareAction title={title} path={sharePath} />,
        }}
      />
      <Screen
        hasContent={hasContent}
        error={error}
        offlineNotice={offlineNotice}
        onRefresh={onRefresh}
        refreshing={refreshing}
        edges={EDGES}
        testID={testID}
      >
        <View style={[styles.article, sheet === undefined ? styles.articleEnd : null]}>
          <FadeUp>
            <View style={styles.header}>
              <Heading accessibilityRole="header">{title}</Heading>
              <Body style={styles.summary}>{summary}</Body>
            </View>
          </FadeUp>
          <View style={styles.body}>{children}</View>
        </View>
        {sheet}
      </Screen>
    </>
  );
}

function ShareAction({ title, path }: { readonly title: string; readonly path: string }) {
  const t = useT('mobile.content');
  return (
    <IconButton
      icon={Glyphs.Share}
      label={t('share')}
      variant="ghost"
      onPress={() => void share(title, `${siteUrl()}/${currentLocale()}${path}`, t('shareFailed'))}
      testID="static-page-share"
    />
  );
}

async function share(title: string, url: string, failed: string): Promise<void> {
  try {
    await Share.share({ message: `${title} — ${url}`, url, title });
  } catch {
    announce(failed, { assertive: true });
  }
}

/** A paragraph of the body. */
export function Paragraph({
  children,
  tone,
  testID,
}: {
  readonly children: ReactNode;
  /** `secondary` for an aside (the web's `text-white/64`); the reading tone by default. */
  readonly tone?: 'secondary';
  readonly testID?: string;
}) {
  return (
    <Story tone={tone} testID={testID}>
      {children}
    </Story>
  );
}

/** A section heading of the body (the web's `h2`). */
export function Heading2({ children }: { readonly children: ReactNode }) {
  return (
    <Subheading accessibilityRole="header" style={styles.heading2}>
      {children}
    </Subheading>
  );
}

/** A list without bullets, ruled down its left edge (the web's `ul`). */
export function RuledList({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  return (
    <View style={styles.list} testID={testID}>
      {children}
    </View>
  );
}

type Tag = (chunks: ReactNode) => ReactNode;

/** What a `t.rich` call inside {@link RichParagraph} renders its tags with. */
export interface RichTags {
  /** `<b>`: medium weight in the surface's primary tone. */
  readonly b: Tag;
  /** A link tag: underlined primary text that pushes an app route. Never lime. */
  readonly link: (href: Href) => Tag;
}

/**
 * A paragraph from `t.rich`, with bold and inline links.
 *
 * A link is a nested `Text` with the link role, underlined in the surface's primary tone, which
 * pushes its route. Nested links are hard to reach with TalkBack and with a switch, so each is
 * also one custom accessibility action on the paragraph, named by its words: the paragraph is
 * read whole, and its links are in the actions menu.
 *
 * ```tsx
 * <RichParagraph>
 *   {(tag) => t.rich('next.body', { howItWorks: tag.link('/how-it-works') })}
 * </RichParagraph>
 * ```
 */
export function RichParagraph({
  children,
  tone,
  testID,
}: {
  readonly children: (tags: RichTags) => ReactNode;
  readonly tone?: 'secondary';
  readonly testID?: string;
}) {
  const router = useRouter();
  const ink = TONES[useSurface()].primary;
  const links: { readonly label: string; readonly href: Href }[] = [];

  const tags: RichTags = {
    b: (chunks) => <Text style={[styles.strong, { color: ink }]}>{chunks}</Text>,
    link: (href) => (chunks) => {
      links.push({ label: textOf(chunks), href });
      return (
        <Text accessibilityRole="link" onPress={() => router.push(href)} style={[styles.link, { color: ink }]}>
          {chunks}
        </Text>
      );
    },
  };
  const content = children(tags);

  return (
    <Story
      tone={tone}
      testID={testID}
      accessibilityActions={
        links.length === 0 ? undefined : links.map((link, index) => ({ name: `link-${index}`, label: link.label }))
      }
      onAccessibilityAction={(event) => {
        const link = links[Number(event.nativeEvent.actionName.replace('link-', ''))];
        if (link !== undefined) router.push(link.href);
      }}
    >
      {content}
    </Story>
  );
}

/** The words of `t.rich` chunks, for an accessibility action's name. */
export function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return textOf(child.props.children);
      return '';
    })
    .join('');
}

/** A stack route: no tab bar under it, so the page owns the bottom inset. */
const EDGES = ['left', 'right', 'bottom'] as const;

const styles = StyleSheet.create({
  article: { paddingTop: spacing[6], gap: spacing[10] },
  articleEnd: { paddingBottom: spacing[12] },
  header: { gap: spacing[4] },
  summary: { fontSize: fontSize.lg, lineHeight: lineHeight.lead },
  body: { gap: spacing[5] },
  heading2: { marginTop: spacing[12] - spacing[5], marginBottom: spacing[3] - spacing[5] },
  list: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingLeft: spacing[5],
    gap: spacing[3],
  },
  strong: { ...font.medium },
  link: { textDecorationLine: 'underline' },
});
