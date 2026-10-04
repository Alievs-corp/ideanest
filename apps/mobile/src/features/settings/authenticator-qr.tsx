import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { create } from 'qrcode';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, formMeasure, radius } from '../../theme';

/** The quiet zone the QR specification asks for: four modules of white on every side. */
export const QUIET_ZONE = 4;

/** The dark modules of the QR symbol for `text`, row by row, exactly as `qrcode` encodes it. */
export function qrMatrix(text: string): readonly (readonly boolean[])[] {
  const { modules } = create(text);
  return Array.from({ length: modules.size }, (_, row) =>
    Array.from({ length: modules.size }, (_, column) => modules.get(row, column) === 1),
  );
}

/**
 * One square per dark module, offset by the quiet zone. A single path, so one native view, and
 * one fill: adjacent squares cannot show anti-aliased seams between them.
 */
export function qrPath(matrix: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  matrix.forEach((cells, row) => {
    cells.forEach((dark, column) => {
      if (dark) parts.push(`M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
    });
  });
  return parts.join('');
}

/**
 * The `otpauth://` URI as a QR code, encoded on the phone (#161): for an authenticator on another
 * device. Never sent to a QR service, since the URI carries the secret.
 *
 * <p>Near-black modules on a white quiet zone (`textOnWhite` on `whiteSurface`, 19.3:1), whatever
 * the surface around it, because a camera needs the contrast the specification assumes.
 */
export function AuthenticatorQr({
  uri,
  label,
  testID,
}: {
  readonly uri: string;
  readonly label: string;
  readonly testID?: string;
}) {
  const matrix = useMemo(() => qrMatrix(uri), [uri]);
  const extent = matrix.length + QUIET_ZONE * 2;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={styles.frame}
      testID={testID}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${extent} ${extent}`}>
        <Rect x={0} y={0} width={extent} height={extent} fill={colors.whiteSurface} />
        <Path
          d={qrPath(matrix)}
          fill={colors.textOnWhite}
          testID={testID === undefined ? undefined : `${testID}-modules`}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    maxWidth: formMeasure / 2,
    aspectRatio: 1,
    alignSelf: 'center',
    backgroundColor: colors.whiteSurface,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
});
