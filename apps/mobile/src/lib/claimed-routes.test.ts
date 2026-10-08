import { existsSync } from 'node:fs';
import path from 'node:path';
import { CLAIMED_ROUTES } from '@ideanest/links/claims';

/**
 * Every screen the claimed-route table promises exists (#165). A row whose route file is renamed
 * or deleted would otherwise be a link the association hands to the app and the app drops.
 */
const APP = path.join(__dirname, '..', 'app');

describe('CLAIMED_ROUTES', () => {
  it.each(CLAIMED_ROUTES.flatMap((route) => route.routes.map((file) => [route.id, file] as const)))(
    '%s opens a route file that exists: %s',
    (_id, file) => {
      expect(existsSync(path.join(APP, `${file}.tsx`))).toBe(true);
    },
  );
});
