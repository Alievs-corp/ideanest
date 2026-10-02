import { render, screen } from '@testing-library/react-native';
import { create } from 'qrcode';
import { AuthenticatorQr, QUIET_ZONE, qrMatrix, qrPath } from './authenticator-qr';

/**
 * The QR code is drawn from the exact `otpauthUri` (#161): the squares on screen are the modules
 * `qrcode` encodes for that string, offset by the quiet zone, and nothing else.
 */

const URI = 'otpauth://totp/IdeyaNest:aysel%40example.az?secret=ABCDEFGHIJKLMNOP&issuer=IdeyaNest&algorithm=SHA1&digits=6&period=30';

/** Reads the drawn path back into a matrix: every `M{x} {y}h1v1h-1z` is one dark module. */
function decodePath(d: string, size: number): boolean[][] {
  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const squares = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)];
  expect(squares.map((square) => square[0]).join('')).toBe(d);
  for (const [, x, y] of squares) {
    const row = matrix[Number(y) - QUIET_ZONE];
    if (row === undefined) throw new Error(`a square outside the symbol at row ${y}`);
    expect(Number(x) - QUIET_ZONE).toBeLessThan(size);
    row[Number(x) - QUIET_ZONE] = true;
  }
  return matrix;
}

function encoderMatrix(text: string): boolean[][] {
  const { modules } = create(text);
  return Array.from({ length: modules.size }, (_, row) =>
    Array.from({ length: modules.size }, (_, column) => modules.get(row, column) === 1),
  );
}

describe('the authenticator QR code', () => {
  it('is the matrix qrcode produces for the exact URI', () => {
    expect(qrMatrix(URI)).toEqual(encoderMatrix(URI));
    // A different URI is a different symbol, so the comparison above is not vacuous.
    expect(qrMatrix(`${URI}x`)).not.toEqual(qrMatrix(URI));
  });

  it('draws exactly those modules, inside a four-module white quiet zone', async () => {
    await render(<AuthenticatorQr uri={URI} label="QR code for your authenticator" testID="qr" />);

    const expected = encoderMatrix(URI);
    const drawn = screen.getByTestId('qr-modules', { includeHiddenElements: true });
    const d = drawn.props.d as string;
    expect(decodePath(d, expected.length)).toEqual(expected);
    expect(d).toBe(qrPath(expected));
  });

  it('is one image to a screen reader, named for what it is for', async () => {
    await render(<AuthenticatorQr uri={URI} label="QR code for your authenticator" testID="qr" />);

    const image = screen.getByRole('image', { name: 'QR code for your authenticator' });
    expect(image.props.accessible).toBe(true);
  });
});
