import { Stack, useRouter } from 'expo-router';
import { FailureState } from '../components/failure-state';

/**
 * Where an unmatched route lands.
 *
 * It exists because a link this application does not have a screen for is not
 * rare — every campaign link is shared with people whose copy is older than the
 * route it names. `lib/links.ts` refuses a link from a host we do not claim
 * before it gets here; what reaches this screen is one of ours that this build
 * does not know about, and the useful thing to offer is the way back rather than
 * an apology. The action is a white pill, as on the web's failure pages.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <FailureState
        title="That page is not in the app"
        description="This version of IdeyaNest does not have a screen for that link. It may be on the web."
        actionLabel="Go to Home"
        onAction={() => router.replace('/')}
      />
    </>
  );
}
