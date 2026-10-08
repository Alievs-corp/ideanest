import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * A route's stable root `testID`, `screen-<name>` — issue #165's end-to-end suite.
 *
 * The Maestro flows (`apps/mobile/e2e/maestro/`) assert where a link or a tap landed. A screen's
 * own root changes with its state — a skeleton, a failure, a signed-out notice — so the root it
 * draws is not something a flow can wait for. This wrapper is the one element every state of a
 * route shares. `collapsable={false}` keeps it a native view, because a view that draws nothing
 * is otherwise flattened away on Android and its id with it.
 *
 * `e2e/generate-links-flow.mjs` reads the name from the route file (`withScreenRoot('<name>'`),
 * so the literal must stay the first argument.
 */
export function withScreenRoot<P extends object>(name: string, Screen: ComponentType<P>): ComponentType<P> {
  function ScreenRoot(props: P) {
    return (
      <View collapsable={false} style={styles.root} testID={`screen-${name}`}>
        <Screen {...props} />
      </View>
    );
  }
  ScreenRoot.displayName = `ScreenRoot(${name})`;
  return ScreenRoot;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
