import { StyleSheet, View } from 'react-native';
import { Slot, Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import type { ProjectLoadCopy } from '@ideanest/campaign-editor/copy';
import { traceIdOfError } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { Eyebrow, InlineAlert, MotionBudgetProvider, Pill, Screen, Tag } from '../../components/ui';
import { signInHrefFor } from '../../lib/guard';
import { formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, spacing } from '../../theme';
import { EditorProvider, useEditor } from './editor-context';
import { EditorTabs, editorTabHref, editorTabOf } from './editor-tabs';
import { RevisionNotice } from './revision-notice';
import { SaveStatus } from './save-status';
import { useEditorChromeCopy } from './translator';

/**
 * `campaigns/[id]/edit/*` — the web's `EditorShell`, as the layout every tab renders inside (#162).
 *
 * <p>The stack header names the project ("Loading" until it has loaded) and carries `SaveStatus`
 * on the right. Under it: the eyebrow and the state tag, then the six tab pills, then the tab.
 * Switching tabs flushes the autosave first and then REPLACES the route, so Back leaves the editor
 * instead of walking through the tabs.
 *
 * <p>The states every tab shares are drawn here, once: signed out (no session on the phone, or a
 * 401) with Sign in and the way back; a failed load with the 403 and 404 wording and "Try again";
 * offline with nothing cached; and, above a loaded tab, the offline notice (the project as last
 * loaded, read-only) and the offer of a change an earlier launch left unsent. Loading is each
 * tab's own skeleton, because each tab's layout is different.
 *
 * <p>Motion: none but the stack's own transitions and the save indicator's spinner.
 */
export function EditorFrame() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = typeof id === 'string' ? id : '';
  return (
    // Keyed: another project is another editor — its own autosave, offer and freshness.
    <EditorProvider key={projectId} projectId={projectId}>
      {/* The editor's budget is the save indicator only (#162): no press scale, no shimmer. */}
      <MotionBudgetProvider level="none">
        <Frame />
      </MotionBudgetProvider>
    </EditorProvider>
  );
}

const EDGES = ['left', 'right', 'bottom'] as const;

function Frame() {
  const editor = useEditor();
  const queryClient = useQueryClient();
  const copy = useEditorChromeCopy();
  const t = useT('mobile.editor');
  const tAll = useT();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const active = editorTabOf(pathname);
  const { project, load, autosave, online } = editor;
  // Online with a cached copy whose refresh failed: the form is shown from the cache, read-only.
  const refreshFailed = online && project !== null && !editor.fresh && editor.canSeed;
  const state = autosave.state;

  return (
    <View style={styles.frame}>
      <Stack.Screen
        options={{
          title:
            project?.title ?? (load === 'loading' ? copy.loadingTitle : tAll('mobile.fallback.editCampaign')),
          headerBackTitle: tAll('mobile.nav.back'),
          headerRight: () => <SaveStatus state={state} copy={copy.save} />,
        }}
      />
      <View style={styles.head}>
        <Eyebrow>{copy.eyebrow}</Eyebrow>
        {project === null ? null : <Tag label={copy.states[project.state]} testID="editor-state" />}
      </View>
      <EditorTabs
        active={active}
        labels={copy.tabs}
        sectionsLabel={copy.sectionsLabel}
        onSelect={(tab) => {
          // What was typed on this tab goes before the next one opens.
          autosave.flush();
          router.replace(editorTabHref(editor.projectId, tab));
        }}
      />

      {load === 'signed-out' ? (
        <View style={styles.state} testID="editor-signed-out">
          <InlineAlert
            variant="info"
            title={copy.signedOutTitle}
            description={t('signedOutDetail')}
            action={
              <Pill
                label={tAll('shell.actions.signIn')}
                size="sm"
                onPress={() => router.push(signInHrefFor(pathname))}
              />
            }
          />
        </View>
      ) : load === 'failed' || load === 'unreachable' ? (
        <Screen
          hasContent={false}
          edges={EDGES}
          error={{
            title: copy.loadFailedTitle,
            description: load === 'unreachable' ? tAll('mobile.offline.nothingCached') : loadFailure(editor.error, copy.load),
            onRetry: editor.reload,
            retrying: editor.query.isFetching,
            traceId: load === 'failed' ? traceIdOfError(editor.error) : null,
          }}
          testID="editor-failed"
        />
      ) : (
        <>
          {load === 'ready' && (!online || autosave.unsent !== null || refreshFailed) ? (
            <View style={styles.notices}>
              {online ? null : (
                <InlineAlert
                  variant="warning"
                  politeness="polite"
                  description={t('offlineReadOnly')}
                  testID="editor-offline"
                />
              )}
              {refreshFailed ? (
                <InlineAlert
                  variant="danger"
                  title={copy.loadFailedTitle}
                  description={loadFailure(editor.error, copy.load)}
                  testID="editor-refresh-failed"
                  action={
                    <Pill
                      label={copy.tryAgain}
                      size="sm"
                      variant="ghost"
                      busy={editor.query.isFetching}
                      onPress={editor.reload}
                    />
                  }
                />
              ) : null}
              {autosave.unsent === null ? null : (
                <InlineAlert
                  variant="info"
                  title={t('unsent.title', { time: formatDateTime(autosave.unsent.at, locale) })}
                  description={t('unsent.body')}
                  testID="editor-unsent"
                  action={
                    <View style={styles.actions}>
                      <Pill
                        label={t('unsent.send')}
                        size="sm"
                        // Not before the service's current copy is in: the offer goes over it.
                        disabled={editor.readOnly}
                        onPress={() => void autosave.sendUnsent()}
                        testID="editor-unsent-send"
                      />
                      <Pill
                        label={t('unsent.discard')}
                        size="sm"
                        variant="ghost"
                        onPress={autosave.discardUnsent}
                        testID="editor-unsent-discard"
                      />
                    </View>
                  }
                />
              )}
            </View>
          ) : null}
          {load === 'ready' && project !== null ? (
            <RevisionNotice
              projectId={editor.projectId}
              project={project}
              copy={copy.revision}
              readOnly={editor.readOnly}
              onProject={editor.apply}
              onDiscarded={() => {
                // What was typed on top of the thrown-away edit must not be sent over the live copy.
                autosave.dropQueued(Object.keys(autosave.unsaved ?? {}));
                editor.reseed();
                // Tiers created or removed in the thrown-away edit are not the list any more.
                void queryClient.invalidateQueries({ queryKey: queryKeys.editorRewards(editor.projectId) });
              }}
            />
          ) : null}
          <View style={styles.tab}>
            <Slot />
          </View>
        </>
      )}
    </View>
  );
}

/** The web's `useProjectEdit` `messageFor`, in the shared builder's words. */
function loadFailure(error: unknown, copy: ProjectLoadCopy): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return copy.forbidden;
    // 404 covers "no such project" and "not yours", deliberately indistinguishable.
    if (error.status === 404) return copy.notFound;
    return error.problem?.detail ?? error.problem?.title ?? copy.refused;
  }
  return copy.unreachable;
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.surface1 },
  head: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
  },
  state: { padding: spacing[5] },
  notices: { gap: spacing[3], paddingHorizontal: spacing[5], paddingTop: spacing[3] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  tab: { flex: 1 },
});
