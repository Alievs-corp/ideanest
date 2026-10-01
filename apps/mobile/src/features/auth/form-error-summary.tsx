import { useEffect, useRef } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { InlineAlert } from '../../components/ui';
import type { AuthFailure } from '../../lib/auth-failures';

/**
 * A refusal at the top of a form, which takes the screen reader's focus when it appears — the
 * web's `FormErrorSummary` (issue #152).
 *
 * <p>The alert is announced either way (`InlineAlert` is assertive for `danger`). Moving focus
 * as well is what puts the reader where the next action is: after a refused submit their focus
 * is still on the button at the bottom, and swiping onward from there reads the footer.
 */
export function FormErrorSummary({
  failure,
  testID,
}: {
  readonly failure: AuthFailure | null;
  readonly testID?: string;
}) {
  const container = useRef<View>(null);

  useEffect(() => {
    if (failure === null) return;
    /*
     * A tick later, not in the commit that mounts the view: VoiceOver does not yet have a node
     * that was added in the same frame, and focusing nothing is silent.
     */
    const timer = setTimeout(() => {
      if (container.current !== null) {
        AccessibilityInfo.sendAccessibilityEvent(container.current, 'focus');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [failure]);

  if (failure === null) return null;

  return (
    <View ref={container} accessible testID={testID}>
      <InlineAlert variant="danger" title={failure.title} description={failure.detail} />
    </View>
  );
}
