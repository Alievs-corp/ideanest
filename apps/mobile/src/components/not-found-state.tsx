import { Stack, useRouter } from 'expo-router';
import { useT } from '../lib/i18n';
import { FailureState } from './failure-state';

/**
 * "There is nothing at this address" — the unmatched route's screen, and what a route draws for a
 * slug that names nothing (issue #154: an unknown category, subcategory or collection; #155: a
 * campaign that does not exist or has no public page).
 *
 * One component, so a link to `/categories/gmaes` and a link to a route this build does not have
 * say the same thing and offer the same way back. The action is the home page, which is what its
 * label promises — a white pill, as on the web's failure pages — unless the screen names a better
 * way out: the campaign page sends a reader on to other campaigns.
 */
export function NotFoundState({
  action,
  testID,
}: {
  readonly action?: { readonly label: string; readonly onPress: () => void };
  readonly testID?: string;
}) {
  const router = useRouter();
  const t = useT('shell.failure.pages.notFound');
  return (
    <>
      <Stack.Screen options={{ title: t('metaTitle') }} />
      <FailureState
        title={t('title')}
        description={t('description')}
        actionLabel={action?.label ?? t('action')}
        onAction={action?.onPress ?? (() => router.replace('/'))}
        testID={testID}
      />
    </>
  );
}
