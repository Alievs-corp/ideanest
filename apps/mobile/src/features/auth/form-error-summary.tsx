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
    if (failure === null || container.current === null) return;
    AccessibilityInfo.sendAccessibilityEvent(container.current, 'focus');
  }, [failure]);

  if (failure === null) return null;

  return (
    <View ref={container} accessible testID={testID}>
      <InlineAlert variant="danger" title={failure.title} description={failure.detail} />
    </View>
  );
}
