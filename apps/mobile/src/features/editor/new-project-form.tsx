import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { TITLE_MAX_CHARACTERS, characterCount } from '@ideanest/campaign-editor/basics';
import {
  basicsValidationCopyFrom,
  newProjectCopyFrom,
  type NewProjectCopy,
} from '@ideanest/campaign-editor/copy';
import { queryKeys } from '../../api/queries';
import {
  Body,
  CharacterCount,
  Field,
  Heading,
  InlineAlert,
  MotionBudgetProvider,
  Pill,
  TextInput,
} from '../../components/ui';
import { signInHrefFor } from '../../lib/guard';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { colors, spacing } from '../../theme';
import { createProject } from './api';
import { useEditorTranslators } from './translator';

const PATH = '/campaigns/new';

/** The web's `NewProjectForm` `messageFor`: 401 and 403 have their words; else the service's. */
export function newProjectFailure(cause: unknown, copy: NewProjectCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return copy.signInFirst;
    if (cause.status === 403) return copy.notAllowed;
    return cause.problem?.detail ?? cause.problem?.title ?? copy.notCreated;
  }
  return copy.unreachable;
}

/**
 * `campaigns/new` — the web's `NewProjectForm` (#162). One field, then the editor.
 *
 * <p>It asks before it creates: opening the screen creates nothing. `POST /v1/projects {title}`
 * with the trimmed title, then `router.replace` to the new draft's Basics, so Back does not return
 * to a form that would create a second one. Return on the keyboard submits. The button is the
 * kit's white primary, full width — starting a project is the screen's main action, not an urgent
 * one, so not lime. Signed out, the screen sends the reader to sign in and back here.
 */
export function NewProjectScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { signedIn } = useSession();
  const tAll = useT();
  const { t } = useEditorTranslators();
  const copy = useMemo(() => newProjectCopyFrom(t), [t]);
  const validation = useMemo(() => basicsValidationCopyFrom(t), [t]);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) router.replace(signInHrefFor(PATH));
  }, [signedIn, router]);

  const trimmed = title.trim();
  const length = characterCount(trimmed);
  const tooLong = length > TITLE_MAX_CHARACTERS;
  const blocked = trimmed === '' || tooLong || creating;

  async function create(): Promise<void> {
    if (blocked) return;
    setCreating(true);
    setFailure(null);
    try {
      const project = await createProject(trimmed);
      // The editor opens on the answer rather than reading it again.
      queryClient.setQueryData(queryKeys.projectEdit(project.id), project);
      void queryClient.invalidateQueries({ queryKey: queryKeys.myProjects() });
      router.replace({ pathname: '/campaigns/[id]/edit/basics', params: { id: project.id } });
    } catch (cause) {
      setFailure(newProjectFailure(cause, copy));
      setCreating(false);
    }
  }

  return (
    <MotionBudgetProvider level="none">
      <View style={styles.screen}>
        <Stack.Screen options={{ title: copy.heading, headerBackTitle: tAll('mobile.nav.back') }} />
        {signedIn ? (
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing[3]) + spacing[5] }]}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Heading accessibilityRole="header">{copy.heading}</Heading>
            <Body>{copy.intro}</Body>
            {failure === null ? null : (
              <InlineAlert variant="danger" title={copy.notCreatedTitle} description={failure} testID="new-project-failure" />
            )}
            <Field
              label={copy.title}
              required
              hint={fillPlaceholders(copy.titleHint, { max: String(TITLE_MAX_CHARACTERS) })}
              error={
                tooLong
                  ? fillPlaceholders(validation.titleTooLong, {
                      max: String(TITLE_MAX_CHARACTERS),
                      over: String(length - TITLE_MAX_CHARACTERS),
                    })
                  : undefined
              }
            >
              <TextInput
                value={title}
                onChangeText={setTitle}
                autoFocus
                autoComplete="off"
                returnKeyType="go"
                disabled={creating}
                onSubmitEditing={() => void create()}
                testID="new-project-title"
              />
              <CharacterCount count={characterCount(title)} limit={TITLE_MAX_CHARACTERS} />
            </Field>
            {/* Under the field, so it stays above the keyboard with it. */}
            <View style={styles.footer}>
              <Pill
                label={creating ? copy.creating : copy.start}
                size="lg"
                fullWidth
                busy={creating}
                disabled={blocked}
                onPress={() => void create()}
                testID="new-project-start"
              />
            </View>
          </ScrollView>
        ) : null}
      </View>
    </MotionBudgetProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface1 },
  content: { gap: spacing[5], padding: spacing[5] },
  footer: { paddingTop: spacing[1] },
});
